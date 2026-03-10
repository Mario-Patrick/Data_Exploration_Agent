#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Checks ─────────────────────────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  echo "ERROR: Virtual environment not found. Run ./start.sh first."
  exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
  echo "ERROR: Frontend dependencies not installed. Run ./start.sh first."
  exit 1
fi

if [ ! -f ".env" ]; then
  echo "WARNING: No .env file found. Backend may fail without DEEPSEEK_API_KEY."
fi

# ── Activate venv ──────────────────────────────────────────────────────────────
source venv/Scripts/activate

# ── Start both servers ─────────────────────────────────────────────────────────
echo "Starting frontend (Vite)..."
cd frontend
npm run dev &
FRONTEND_PID=$!

cd ..
echo "Starting backend (Flask)..."
python app.py &
BACKEND_PID=$!

echo ""
echo "Both servers running."
echo "  Frontend: http://localhost:5173"
echo "  Backend:  http://localhost:5000"
echo ""
echo "Press Ctrl+C to stop both."

trap "kill $FRONTEND_PID $BACKEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait
