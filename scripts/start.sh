#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -x .venv/bin/python ]]; then
  printf 'Execute bash scripts/setup.sh primeiro.\n' >&2
  exit 1
fi
if [[ ! -f frontend/dist/index.html ]]; then npm ci --prefix frontend; npm run build; fi
export RIFFSYNC_DATA="${RIFFSYNC_DATA:-$PWD/data}"
export OMP_NUM_THREADS="${OMP_NUM_THREADS:-2}"
export MKL_NUM_THREADS="${MKL_NUM_THREADS:-2}"
export TF_CPP_MIN_LOG_LEVEL="${TF_CPP_MIN_LOG_LEVEL:-2}"
mkdir -p "$RIFFSYNC_DATA"
if [[ "${1:-}" == "--background" ]]; then
  if [[ -f "$RIFFSYNC_DATA/api.pid" ]] && kill -0 "$(cat "$RIFFSYNC_DATA/api.pid")" 2>/dev/null; then
    printf 'RiffSync já está ativo na porta 8000.\n'; exit 0
  fi
  nohup .venv/bin/python -m riffsync.worker >>"$RIFFSYNC_DATA/worker.log" 2>&1 &
  echo "$!" >"$RIFFSYNC_DATA/worker.pid"
  nohup .venv/bin/python -m uvicorn riffsync.api:app --host 0.0.0.0 --port 8000 >>"$RIFFSYNC_DATA/api.log" 2>&1 &
  echo "$!" >"$RIFFSYNC_DATA/api.pid"
  printf 'RiffSync iniciado na porta 8000.\n'
else
  .venv/bin/python -m riffsync.worker &
  worker_pid=$!
  trap 'kill "$worker_pid" 2>/dev/null || true' EXIT INT TERM
  .venv/bin/python -m uvicorn riffsync.api:app --host 0.0.0.0 --port 8000
fi
