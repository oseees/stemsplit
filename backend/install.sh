#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

echo "Setting up StemSplit AI backend..."

python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt

echo ""
echo "✅ Backend dependencies installed."
echo "   Run: source venv/bin/activate && uvicorn main:app --reload"
