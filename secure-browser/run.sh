#!/usr/bin/env bash
# One-command launcher for Ramble.
#
# Creates a local virtualenv (first run only), installs PyQt6-WebEngine, then
# starts the browser. Any extra arguments are passed straight through, e.g.
#   ./run.sh https://example.com
#   ./run.sh --max-live-tabs 3 --idle-seconds 60
set -euo pipefail

cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
VENV=".venv"

if [ ! -d "$VENV" ]; then
  echo "Ramble: creating virtualenv in $VENV ..."
  "$PY" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

# Install/refresh dependencies only when needed.
if ! python -c "import PyQt6.QtWebEngineWidgets" >/dev/null 2>&1; then
  echo "Ramble: installing dependencies (this can take a minute) ..."
  pip install --quiet --upgrade pip
  pip install --quiet -r requirements.txt
fi

echo "Ramble: launching ..."
exec python -m ramble "$@"
