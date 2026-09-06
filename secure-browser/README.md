# Ramble — a RAM-friendly, secure browser

Ramble is a lightweight desktop web browser focused on two things: **using as
little memory as possible** and **being safe by default**. It's built in Python
on PyQt6's Chromium-based web engine.

> **An honest note on "RAM-friendly."** Rendering the modern web needs a real
> engine, and real engines (Chromium here) are memory-hungry — a browser that
> rendered pages in a few MB doesn't exist. Ramble's win isn't a lighter engine;
> it's *not keeping renderers alive for tabs you aren't looking at*. Idle tabs
> are torn down completely and rebuilt on demand, and a hard cap limits how many
> renderer processes can run at once. That's where the real savings are.

## RAM-friendly features

- **Idle-tab suspension.** A background tab untouched for a while (5 min by
  default) has its entire renderer process destroyed. The tab stays in the strip
  as a tiny placeholder and reloads instantly when you click it. This is the
  single biggest memory saver.
- **Live-renderer cap.** At most N tabs (6 by default) may hold a live renderer
  at once. Open a seventh and the least-recently-used one is suspended.
- **Memory-capped caches.** The HTTP cache is in-memory and capped at 64 MB;
  by default the whole session is off-the-record, so nothing spills to disk.
- **A live meter** in the status bar shows live vs. suspended tabs.

## Security features

- **Ad/tracker blocking.** Every request runs through a blocklist (built-in
  defaults + your own `blocklist.txt`); matches are dropped before they hit the
  network.
- **HTTPS-only.** `http://` is force-upgraded to `https://` (localhost excepted).
- **Invalid certificates are rejected** — no click-through.
- **Dangerous URL schemes blocked** (`file:`, `data:`, `javascript:`, …).
- **Permission prompts denied by default** (camera, microphone, geolocation, …).
- **Popups become tabs.** `window.open`/`target=_blank` open a normal foreground
  tab instead of an uncontrolled window; insecure-content and clipboard access
  from JS are off.
- **Off-the-record by default** — no persistent cookies, cache, or history.

## Install & run

```bash
cd secure-browser
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m ramble                       # opens the home page
python -m ramble https://example.com   # open a specific URL
```

On a headless Linux box you'll also need system Qt/OpenGL libraries (e.g.
`libgl1`, `libxkbcommon0`, `libegl1`) and a display (or `xvfb-run`).

### Options

```
python -m ramble --help
  url                    URL to open on start
  --idle-seconds N       suspend a background tab after N idle seconds (default 300)
  --max-live-tabs N      cap live renderers; 0 disables (default 6)
  --no-suspend           never suspend tabs
  --allow-http           don't force-upgrade http to https
  --no-javascript        start with JavaScript disabled
  --persist              persist cookies/cache to disk (default: off-the-record)
```

## Custom blocklist

Add domains (one per line) to `ramble/blocklist.txt`, or point
`RAMBLE_BLOCKLIST` at your own file. A domain blocks itself and all subdomains.

## Layout

```
secure-browser/
├── ramble/
│   ├── __main__.py     # CLI entry point (python -m ramble)
│   ├── browser.py      # window, tabs, suspension sweep (the UI)
│   ├── security.py     # blocklist + request interceptor (no Qt needed)
│   ├── suspend.py      # pure suspension decision logic (no Qt needed)
│   └── blocklist.txt   # user-extendable blocklist
└── tests/              # unit tests for security.py and suspend.py
```

## Tests

The security and suspension logic is deliberately kept free of Qt so it can be
tested without a display:

```bash
cd secure-browser
python -m pytest        # or: python -m unittest discover -s tests
```
