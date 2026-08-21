import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  type BetaControlCommand,
  type BetaControlResult,
} from "@agenttrading/contracts";
import {
  BetaControlTuiModel,
  type BetaControlCommandRow,
  type BetaControlPort,
  type BetaControlStatusRow,
} from "./control-tui.ts";

export interface BetaControlInkTuiProps {
  session: BetaControlPort;
  onDispatch?: (result: BetaControlResult) => void;
  onError?: (error: Error) => void;
  onExit?: () => void;
}

const HOTKEY_COMMANDS: Record<string, BetaControlCommand> = {
  s: "start",
  x: "stop",
  c: "cancel-all",
  "$": "cash-only",
  r: "reduce-only",
  h: "halt",
};

function emphasisColor(row: BetaControlStatusRow): "white" | "yellow" | "red" {
  if (row.emphasis === "danger") return "red";
  if (row.emphasis === "warning") return "yellow";
  return "white";
}

function commandColor(row: BetaControlCommandRow): "cyan" | "red" {
  return row.dangerous ? "red" : "cyan";
}

/**
 * Minimal Ink operator surface. Keyboard input is intentionally translated into
 * the shared control contract before reaching the session; Ink never owns
 * execution authority or trading state.
 */
export function BetaControlInkTui({
  session,
  onDispatch,
  onError,
  onExit,
}: BetaControlInkTuiProps): React.ReactElement {
  const [model] = useState(() => new BetaControlTuiModel(session));
  const [, rerender] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit?.();
      return;
    }

    const command = HOTKEY_COMMANDS[input];
    if (command === undefined) return;

    try {
      const result = model.dispatch(command);
      onDispatch?.(result);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    } finally {
      rerender((revision) => revision + 1);
    }
  });

  const view = model.view;
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>{view.title}</Text>
      <Box flexDirection="column">
        {view.statusRows.map((row) => (
          <Text key={row.label} color={emphasisColor(row)}>
            {row.label}: {row.value}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column">
        {view.commandRows.map((row) => (
          <Text key={row.command} color={commandColor(row)}>
            [{row.hotkey}] {row.label}
          </Text>
        ))}
      </Box>
      <Text dimColor>{view.footer} | q/esc exit</Text>
    </Box>
  );
}
