#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🎵 Starting StemSplit AI..."

# Backend
echo "▶ Starting FastAPI backend on :8000"
cd "$ROOT/backend"
if [ ! -d "venv" ]; then
  python3 -m venv venv
fi
source venv/bin/activate
pip install -q -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend
echo "▶ Starting Next.js frontend on :3000"
cd "$ROOT/frontend"
npm install --silent
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✅ StemSplit AI is running!"
echo "   Frontend → http://localhost:3000"
echo "   Backend  → http://localhost:8000"
echo "   API docs → http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
