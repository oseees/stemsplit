#!/usr/bin/env bash
# Start SalesPal locally
set -e
cd "$(dirname "$0")/backend"

if [ ! -d ".venv" ]; then
  echo "Creating virtual environment…"
  python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -r requirements.txt
fi

PORT="${PORT:-8000}"
echo "SalesPal running at http://localhost:$PORT"
exec ./.venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT"
