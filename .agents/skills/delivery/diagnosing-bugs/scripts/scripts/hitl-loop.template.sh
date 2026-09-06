#!/usr/bin/env bash
# Human-in-the-loop reproduction loop.
# Copy this file, replace the scenario-specific placeholders below, and run it.
# The agent runs the script; the user follows prompts in their terminal.
#
# Usage:
#   bash hitl-loop.template.sh
#
# Two helpers:
#   step "<instruction>"          → show instruction, wait for Enter
#   capture VAR "<question>"      → show question, read response into VAR
#
# At the end, captured values are printed as KEY=VALUE for the agent to parse.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p "    [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p "    > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

capture SCENARIO "Name the scenario being reproduced:"

capture ENVIRONMENT "Describe the environment, version, account type, device, or browser:"

step "Prepare the system under the exact conditions described in the bug report."

step "Perform the first reproduction action."

capture EXPECTED "What did you expect to happen at this point?"

capture ACTUAL "What actually happened?"

capture EVIDENCE "Paste the error, screenshot path, log excerpt, or 'none':"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'SCENARIO=%s\n' "$SCENARIO"
printf 'ENVIRONMENT=%s\n' "$ENVIRONMENT"
printf 'EXPECTED=%s\n' "$EXPECTED"
printf 'ACTUAL=%s\n' "$ACTUAL"
printf 'EVIDENCE=%s\n' "$EVIDENCE"
