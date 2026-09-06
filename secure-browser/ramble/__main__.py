"""Command-line entry point: ``python -m ramble``."""

from __future__ import annotations

import argparse
import sys


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="ramble",
        description="A RAM-friendly, secure desktop web browser.",
    )
    parser.add_argument("url", nargs="?", help="URL to open on start.")
    parser.add_argument(
        "--idle-seconds",
        type=float,
        default=300.0,
        help="Suspend a background tab after this many idle seconds (default: 300).",
    )
    parser.add_argument(
        "--max-live-tabs",
        type=int,
        default=6,
        help="Max tabs allowed a live renderer at once; 0 disables the cap (default: 6).",
    )
    parser.add_argument(
        "--no-suspend",
        action="store_true",
        help="Disable idle-tab suspension entirely.",
    )
    parser.add_argument(
        "--allow-http",
        action="store_true",
        help="Do not force-upgrade http:// to https://.",
    )
    parser.add_argument(
        "--no-javascript",
        action="store_true",
        help="Start with JavaScript disabled.",
    )
    parser.add_argument(
        "--persist",
        action="store_true",
        help="Persist cookies/cache to disk instead of running off-the-record.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)

    # Import Qt lazily so ``--help`` and unit tests don't require a display.
    from PyQt6.QtCore import QUrl
    from PyQt6.QtWidgets import QApplication

    from .browser import HOME_URL, BrowserConfig, BrowserWindow
    from .suspend import SuspensionPolicy

    policy = SuspensionPolicy(
        idle_seconds=args.idle_seconds,
        max_live_tabs=args.max_live_tabs,
        enabled=not args.no_suspend,
    )
    config = BrowserConfig(
        home_url=args.url or HOME_URL,
        https_only=not args.allow_http,
        javascript_enabled=not args.no_javascript,
        private=not args.persist,
        policy=policy,
    )

    app = QApplication(sys.argv[:1])
    app.setApplicationName("Ramble")
    window = BrowserWindow(config)
    window.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
