#!/usr/bin/env bash
# Launch the Track2MIDI desktop app using the shared backend venv.
set -e
cd "$(dirname "$0")"
VENV="../backend/venv/bin/python"
if [ ! -x "$VENV" ]; then
  echo "venv not found at $VENV — run setup.sh first." >&2
  exit 1
fi
export PYTORCH_ENABLE_MPS_FALLBACK=1
exec "$VENV" gui.py
