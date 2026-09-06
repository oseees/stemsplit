"""Idle-tab suspension - the core RAM-saving mechanism.

Modern web engines spawn a renderer process per live page, and those processes
dominate a browser's memory footprint. The single most effective way to stay
RAM-friendly is therefore to *destroy* the renderer of tabs you are not looking
at and rebuild them on demand.

:class:`SuspensionPolicy` holds the tunables and the pure decision logic so it
can be reasoned about (and tested) without any Qt widgets. The actual teardown
and restore of a ``QWebEngineView`` lives in ``browser.BrowserTab`` which calls
into this policy.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class SuspensionPolicy:
    """Rules for when an inactive tab should have its renderer freed.

    Attributes:
        idle_seconds: A background tab untouched for this long is eligible for
            suspension. Default 5 minutes.
        max_live_tabs: Hard cap on tabs that may hold a live renderer at once.
            When exceeded, the least-recently-used background tabs are suspended
            immediately regardless of ``idle_seconds``. ``0`` disables the cap.
        enabled: Master switch; when ``False`` nothing is ever suspended.
    """

    idle_seconds: float = 300.0
    max_live_tabs: int = 6
    enabled: bool = True

    def should_suspend_idle(self, last_active: float, is_current: bool, now: float | None = None) -> bool:
        """Whether a single background tab is stale enough to suspend."""

        if not self.enabled or is_current:
            return False
        now = time.monotonic() if now is None else now
        return (now - last_active) >= self.idle_seconds

    def over_live_budget(self, live_count: int) -> bool:
        """Whether the number of live renderers exceeds the configured cap."""

        if not self.enabled or self.max_live_tabs <= 0:
            return False
        return live_count > self.max_live_tabs

    def surplus(self, live_count: int) -> int:
        """How many live tabs must be suspended to get back under budget."""

        if not self.over_live_budget(live_count):
            return 0
        return live_count - self.max_live_tabs
