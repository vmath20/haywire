#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cleanup() {
  [[ -n "${BACKEND_PID:-}" ]] && kill "$BACKEND_PID" 2>/dev/null || true
  [[ -n "${FRONT_PID:-}" ]] && kill "$FRONT_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd "$ROOT/backend"
python3 -m uvicorn main:app --port 8000 --reload &
BACKEND_PID=$!

cd "$ROOT"
npm run dev -- -p 3000 &
FRONT_PID=$!

echo "Haywire"
echo "  UI:  http://localhost:3000"
echo "  API: http://127.0.0.1:8000"
echo "Try:   http://localhost:3000/karpathy/nanoGPT"
wait
