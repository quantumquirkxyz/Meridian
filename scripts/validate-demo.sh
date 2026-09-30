#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== MERIDIAN DEMO VALIDATION ==="
echo ""

# Prerequisite: bun must be available
if ! command -v bun &> /dev/null; then
  echo "FAIL: bun is not installed or not in PATH"
  exit 1
fi

echo "bun version: $(bun --version)"
echo ""

# Run the TypeScript validation checks
echo "Running TypeScript validation checks..."
echo ""

set +e
bun run scripts/validate-demo.ts
VALIDATION_EXIT=$?
set -e

echo ""
if [ "$VALIDATION_EXIT" -eq 0 ]; then
  echo "=== DEMO VALIDATION: PASS ==="
else
  echo "=== DEMO VALIDATION: FAIL ==="
fi

exit "$VALIDATION_EXIT"
