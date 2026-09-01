#!/usr/bin/env bash
# Generate the demo evidence bundle for promotion review.
# Usage: bash scripts/export-demo-evidence.sh <sessionDir>
set -euo pipefail

SESSION_DIR="${1:-reports/latest}"
if [ ! -d "$SESSION_DIR" ]; then
  echo "Usage: $0 <sessionDir>"; echo "Directory not found: $SESSION_DIR"; exit 1
fi

echo "=== EVIDENCE EXPORT ==="
echo "Source: $SESSION_DIR"
echo "Files:"
ls -la "$SESSION_DIR"
echo ""
echo "Audit events (count):"
if [ -f "$SESSION_DIR/audit.jsonl" ]; then wc -l < "$SESSION_DIR/audit.jsonl"; else echo "0"; fi
echo "Summary exists:"
[ -f "$SESSION_DIR/summary.json" ] && echo "Yes" || echo "No"
echo "Manifest exists:"
[ -f "$SESSION_DIR/manifest.json" ] && echo "Yes" || echo "No"
echo "=== READY FOR MANUAL PROMOTION CHECK ==="
