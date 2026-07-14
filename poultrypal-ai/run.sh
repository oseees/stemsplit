#!/usr/bin/env bash
# PoultryPal AI — one-command dev launcher.
# Creates a dedicated venv (does NOT touch the shared backend/venv), installs deps,
# builds the knowledge index if missing, and starts the server.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON="${PYTHON:-python3}"
VENV=".venv"

if [ ! -d "$VENV" ]; then
  echo "→ creating venv ($($PYTHON --version))"
  "$PYTHON" -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "→ installing dependencies"
pip install -q --upgrade pip
pip install -q -r requirements.txt

if [ ! -f "app/knowledge/index/knowledge_index.json" ]; then
  echo "→ building knowledge index"
  python -m app.knowledge.ingest
fi

if [ ! -f ".env" ]; then
  echo "ℹ️  No .env found — copying .env.example. Add your ANTHROPIC_API_KEY to enable AI diagnosis."
  cp .env.example .env
fi

# --- Voice (ASR) setup -------------------------------------------------------
# Whisper runs in an ISOLATED venv so its heavy wheels (ctranslate2/av) never enter
# the 3.14 app venv. Whisper has no 3.14 wheels yet, so we build this venv from a
# Python 3.9–3.13 interpreter. Voice input is optional: if none is found the app
# still runs and the voice button simply stays hidden.
ASR_VENV=".venv-asr"
if [ ! -d "$ASR_VENV" ]; then
  echo "→ setting up voice (ASR) environment"
  ASR_PY="${POULTRYPAL_ASR_PYTHON:-}"
  if [ -z "$ASR_PY" ]; then
    for c in python3.12 python3.11 python3.10 python3.9 \
             "/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9"; do
      if "$c" --version >/dev/null 2>&1; then
        v=$("$c" -c 'import sys;print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0)
        if [ "$v" -ge 309 ] && [ "$v" -le 313 ]; then ASR_PY="$c"; break; fi
      fi
    done
  fi
  if [ -n "$ASR_PY" ]; then
    "$ASR_PY" -m venv "$ASR_VENV"
    "$ASR_VENV/bin/python" -m pip install -q --upgrade pip
    "$ASR_VENV/bin/python" -m pip install -q faster-whisper
    echo "  ✅ voice ready ($("$ASR_PY" --version 2>&1)). Model '${POULTRYPAL_WHISPER_MODEL:-small}' downloads on first use."
  else
    echo "  ⚠️ No Python 3.9–3.13 found for Whisper — voice input disabled."
    echo "     Set POULTRYPAL_ASR_PYTHON=/path/to/python3.x and re-run ./run.sh to enable it."
  fi
fi

echo "→ starting PoultryPal AI on http://localhost:8000"
exec uvicorn app.main:app --reload --port 8000
