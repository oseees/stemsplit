"""Security primitives for Ramble.

Two layers live here:

* :class:`Blocklist` - an in-memory set of ad/tracker/malware domains that is
  cheap to query (suffix match, no regex per request).
* :class:`RequestInterceptor` - a ``QWebEngineUrlRequestInterceptor`` that runs
  on every network request. It blocks listed domains, upgrades ``http`` to
  ``https``, and refuses a handful of dangerous URL schemes.

Keeping this logic out of the UI module makes it unit-testable without a running
Qt event loop (see ``tests/test_security.py``).
"""

from __future__ import annotations

import os
from typing import Iterable
from urllib.parse import urlparse

try:  # Qt is optional at import time so the blocklist can be unit-tested headless.
    from PyQt6.QtCore import QUrl
    from PyQt6.QtWebEngineCore import QWebEngineUrlRequestInterceptor
except Exception:  # pragma: no cover - exercised only in headless test envs.
    QUrl = None  # type: ignore[assignment]
    QWebEngineUrlRequestInterceptor = object  # type: ignore[assignment,misc]


# A deliberately small, dependency-free starter blocklist. Users can extend it
# with their own list via ``RAMBLE_BLOCKLIST`` (see ``Blocklist.load``). The goal
# is a sensible default, not an exhaustive filter set.
DEFAULT_BLOCKED_DOMAINS: tuple[str, ...] = (
    "doubleclick.net",
    "googlesyndication.com",
    "googleadservices.com",
    "google-analytics.com",
    "googletagmanager.com",
    "googletagservices.com",
    "adservice.google.com",
    "ads.yahoo.com",
    "adnxs.com",
    "advertising.com",
    "scorecardresearch.com",
    "quantserve.com",
    "moatads.com",
    "criteo.com",
    "criteo.net",
    "taboola.com",
    "outbrain.com",
    "amazon-adsystem.com",
    "facebook.net",
    "connect.facebook.net",
    "hotjar.com",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    "fullstory.com",
    "mouseflow.com",
    "clarity.ms",
    "bat.bing.com",
    "adroll.com",
    "pubmatic.com",
    "rubiconproject.com",
    "openx.net",
    "casalemedia.com",
    "3lift.com",
    "sharethrough.com",
    "yieldmo.com",
    "zergnet.com",
)

# Schemes we never let a page navigate to or fetch from. ``http``/``https`` are
# handled separately (http is upgraded, not blocked).
DANGEROUS_SCHEMES: frozenset[str] = frozenset(
    {"file", "ftp", "javascript", "vbscript", "data", "chrome", "about"}
)

# Hosts that are legitimately plain-http and should not be force-upgraded.
_HTTPS_UPGRADE_EXCEPTIONS: frozenset[str] = frozenset({"localhost", "127.0.0.1", "::1"})


def _registrable_host(host: str) -> str:
    """Normalise a host: lower-case, strip a leading ``www.`` and any port."""

    host = host.strip().lower()
    if host.startswith("www."):
        host = host[4:]
    if ":" in host and not host.startswith("["):  # strip :port, keep IPv6 brackets
        host = host.split(":", 1)[0]
    return host


class Blocklist:
    """A suffix-matching set of domains to block.

    ``example.com`` in the list blocks ``example.com`` and every subdomain
    (``ads.example.com``) but not unrelated hosts that merely end in the same
    string (``notexample.com``).
    """

    def __init__(self, domains: Iterable[str] | None = None) -> None:
        self._domains: set[str] = set()
        self.extend(domains if domains is not None else DEFAULT_BLOCKED_DOMAINS)

    def extend(self, domains: Iterable[str]) -> None:
        for raw in domains:
            domain = _registrable_host(raw)
            if domain and not domain.startswith("#"):
                self._domains.add(domain)

    def __len__(self) -> int:
        return len(self._domains)

    def __contains__(self, host: str) -> bool:
        return self.is_blocked(host)

    def is_blocked(self, host: str) -> bool:
        host = _registrable_host(host)
        if not host:
            return False
        if host in self._domains:
            return True
        # Walk parent domains: a.b.example.com -> b.example.com -> example.com
        parts = host.split(".")
        for i in range(1, len(parts) - 1):
            if ".".join(parts[i:]) in self._domains:
                return True
        return False

    @classmethod
    def load(cls, path: str | None = None) -> "Blocklist":
        """Build a blocklist from defaults plus an optional user file.

        The path is taken from the argument, else the ``RAMBLE_BLOCKLIST`` env
        var, else ``blocklist.txt`` next to this package. Missing files are
        ignored so the app still runs with only the built-in defaults.
        """

        blocklist = cls(DEFAULT_BLOCKED_DOMAINS)
        candidates = [
            path,
            os.environ.get("RAMBLE_BLOCKLIST"),
            os.path.join(os.path.dirname(__file__), "blocklist.txt"),
        ]
        for candidate in candidates:
            if candidate and os.path.isfile(candidate):
                with open(candidate, "r", encoding="utf-8") as handle:
                    blocklist.extend(line.strip() for line in handle if line.strip())
        return blocklist


def upgrade_to_https(url: str) -> str | None:
    """Return an https version of a plain-http URL, or ``None`` if no change.

    Localhost and loopback addresses are left alone so local development still
    works.
    """

    parsed = urlparse(url)
    if parsed.scheme != "http":
        return None
    if _registrable_host(parsed.hostname or "") in _HTTPS_UPGRADE_EXCEPTIONS:
        return None
    return url.replace("http://", "https://", 1)


class RequestInterceptor(QWebEngineUrlRequestInterceptor):  # type: ignore[misc]
    """Applies :class:`Blocklist` and HTTPS-upgrade policy to every request."""

    def __init__(self, blocklist: Blocklist, https_only: bool = True) -> None:
        super().__init__()
        self.blocklist = blocklist
        self.https_only = https_only
        self.blocked_count = 0
        self.upgraded_count = 0

    def interceptRequest(self, info) -> None:  # noqa: N802 (Qt naming)
        url = info.requestUrl()
        scheme = url.scheme().lower()
        host = url.host()

        if scheme in DANGEROUS_SCHEMES and scheme not in ("about", "chrome"):
            # about:/chrome: are used internally by Qt for blank pages, so allow
            # them; the rest (file:, data:, javascript: navigations, ...) go.
            info.block(True)
            self.blocked_count += 1
            return

        if self.blocklist.is_blocked(host):
            info.block(True)
            self.blocked_count += 1
            return

        if self.https_only and scheme == "http":
            upgraded = upgrade_to_https(url.toString())
            if upgraded is not None and QUrl is not None:
                info.redirect(QUrl(upgraded))
                self.upgraded_count += 1
                return
