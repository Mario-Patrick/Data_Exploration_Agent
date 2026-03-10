#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Python 3.12 ────────────────────────────────────────────────────────────────
# Resolve the Python 3.12 command (unix: python3.12, Windows: py -3.12)
if command -v python3.12 &>/dev/null; then
  PYTHON="python3.12"
elif command -v py &>/dev/null && py -3.12 --version &>/dev/null 2>&1; then
  PYTHON="py -3.12"
else
  echo "Python 3.12 not found. Installing..."
  # Windows (winget)
  if command -v winget &>/dev/null; then
    winget install -e --id Python.Python.3.12 --silent
    echo "Python 3.12 installed. Please restart your terminal and re-run this script."
    exit 0
  # macOS (Homebrew)
  elif command -v brew &>/dev/null; then
    brew install python@3.12
    PYTHON="python3.12"
  # Debian/Ubuntu
  elif command -v apt &>/dev/null; then
    sudo apt update && sudo apt install -y python3.12 python3.12-venv
    PYTHON="python3.12"
  else
    echo "Cannot auto-install Python 3.12. Please install it manually: https://www.python.org/downloads/"
    exit 1
  fi
fi

echo "Using Python: $($PYTHON --version)"

# ── Virtual environment ────────────────────────────────────────────────────────
if [ ! -d "venv" ]; then
  echo "Creating virtual environment..."
  $PYTHON -m venv venv
fi

source venv/Scripts/activate

# ── Python dependencies ────────────────────────────────────────────────────────
echo "Installing Python dependencies..."
pip install -r requirements.txt

# ── .env check ─────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo "WARNING: No .env file found. Create one with DEEPSEEK_API_KEY=your_key"
fi

# ── Frontend dependencies ──────────────────────────────────────────────────────
cd frontend
if [ ! -d "node_modules" ]; then
  echo "Installing frontend dependencies..."
  npm install
fi

# ── Start both servers ─────────────────────────────────────────────────────────
echo "Starting frontend (Vite)..."
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

# Shut down both when Ctrl+C is pressed
trap "kill $FRONTEND_PID $BACKEND_PID 2>/dev/null; exit 0" SIGINT SIGTERM
wait