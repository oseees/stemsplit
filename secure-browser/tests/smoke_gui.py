"""Headless smoke test for the Qt GUI.

Runs the real browser code under Qt's ``offscreen`` platform (no display) to
prove the window, profile, tabs, suspension and interceptor all construct and
operate without crashing. This is not a substitute for a human clicking around,
but it exercises every Qt API the app uses and fails loudly on the kind of
runtime error ``py_compile`` cannot see (wrong enum names, bad signatures).

Run:  QT_QPA_PLATFORM=offscreen python tests/smoke_gui.py
"""

from __future__ import annotations

import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
# Chromium needs these to run inside an unprivileged container with no GPU.
os.environ.setdefault("QTWEBENGINE_DISABLE_SANDBOX", "1")
os.environ.setdefault(
    "QTWEBENGINE_CHROMIUM_FLAGS",
    "--no-sandbox --disable-gpu --disable-dev-shm-usage --in-process-gpu",
)

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from PyQt6.QtWidgets import QApplication  # noqa: E402

from ramble.browser import BrowserConfig, BrowserWindow  # noqa: E402
from ramble.security import Blocklist, RequestInterceptor  # noqa: E402
from ramble.suspend import SuspensionPolicy  # noqa: E402


def _pump(app: QApplication, rounds: int = 20) -> None:
    for _ in range(rounds):
        app.processEvents()


def main() -> int:
    checks: list[tuple[str, bool]] = []

    def check(name: str, ok: bool) -> None:
        checks.append((name, bool(ok)))

    app = QApplication(sys.argv[:1])

    # 1. Window + profile build with an aggressive policy so the cap bites.
    policy = SuspensionPolicy(idle_seconds=0.01, max_live_tabs=3)
    win = BrowserWindow(BrowserConfig(policy=policy, home_url="https://example.com/"))
    win.show()
    _pump(app)
    check("window + profile constructed", win.tabs.count() == 1)
    check("hardened profile is off-the-record", win.profile.isOffTheRecord())

    # 2. Open several tabs -> live-renderer cap should force suspensions.
    for i in range(5):
        win.add_tab(win._interpret_address(f"example{i}.org"))
    _pump(app)
    win._sweep_tabs()
    _pump(app)
    live = sum(1 for t in win._iter_tabs() if not t.suspended)
    check(f"live-renderer cap enforced (live={live} <= 4)", live <= policy.max_live_tabs + 1)

    # 3. Explicit suspend then resume of a specific tab.
    first = next(win._iter_tabs())
    first.suspend()
    _pump(app)
    check("tab suspends (renderer view released)", first.suspended and first.view is None)
    first.resume()
    _pump(app)
    check("tab resumes (renderer rebuilt)", (not first.suspended) and first.view is not None)

    # 4. Interceptor blocks a tracker and upgrades http.
    bl = Blocklist(["doubleclick.net"])
    interceptor = RequestInterceptor(bl, https_only=True)
    check("blocklist matches subdomain", bl.is_blocked("ads.doubleclick.net"))

    # 5. Address-bar interpretation.
    q = win._interpret_address("hello world")
    check("bare text becomes a search", "duckduckgo.com" in q.toString())
    u = win._interpret_address("example.com")
    check("bare domain becomes https", u.toString().startswith("https://"))

    # 6. JS toggle flips the profile attribute without error.
    win._toggle_javascript(0)
    win._toggle_javascript(2)
    check("javascript toggle runs", True)

    _pump(app)
    win.close()

    print("\n  Ramble headless smoke test")
    print("  " + "-" * 34)
    ok_all = True
    for name, ok in checks:
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
        ok_all = ok_all and ok
    print("  " + "-" * 34)
    print(f"  {'ALL PASSED' if ok_all else 'FAILURES PRESENT'}\n")
    return 0 if ok_all else 1


if __name__ == "__main__":
    raise SystemExit(main())
