#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "=== MERIDIAN LIVE READINESS CHECK ==="
echo "[1/4] Config file exists..."; test -f canary-live.json && echo "  OK"
echo "[2/4] Config JSON valid..."
bun -e "const {parseCanaryConfig} = await import('./packages/contracts/src/index.ts'); const j = await Bun.file('canary-live.json').json(); parseCanaryConfig(j); console.log('  OK')"
echo "[3/4] .env is safe (demo mode, demo keys preserved)..."
MODE=$(grep '^MODE=' .env | cut -d= -f2)
if [ "$MODE" = "demo" ]; then echo "  OK (MODE=$MODE)"; else echo "  WARNING: MODE=$MODE (should be demo until live keys pasted)"; fi
echo "[4/4] Endpoint mapping (demo/live separate)..."
grep -q 'DEMO_BASE_URL' packages/connectors/src/bybit-rest.ts && echo "  OK"
echo "=== READY ==="
echo "Next step (manual): replace live keys in .env -> MODE=live -> bun run start --mode live --config canary-live.json"
