#!/usr/bin/env bash
# Arranca todo: backend Python + interfaz ya compilada, en un solo puerto.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-8000}"

if [ ! -d backend/.venv ]; then
  echo "→ creando entorno de Python…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install --quiet -r backend/requirements.txt
fi

if [ ! -d frontend/dist ]; then
  echo "→ compilando la interfaz…"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
fi

echo "→ http://localhost:$PORT"
cd backend
exec .venv/bin/python -m uvicorn api.main:app --host 0.0.0.0 --port "$PORT"
