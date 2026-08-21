import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import {
  type BetaControlResult,
} from "@agenttrading/contracts";
import {
  BetaControlTuiModel,
  commandForHotkey,
  type BetaControlCommandRow,
  type BetaPaperLoopRunner,
  type BetaControlPort,
  type BetaControlStatusRow,
} from "./control-tui.ts";

export interface BetaControlInkTuiProps {
  session: BetaControlPort;
  loopRunner?: BetaPaperLoopRunner;
  onDispatch?: (result: BetaControlResult) => void;
  onError?: (error: Error) => void;
  onExit?: () => void;
}

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
  loopRunner,
  onDispatch,
  onError,
  onExit,
}: BetaControlInkTuiProps): React.ReactElement {
  const [model] = useState(
    () => new BetaControlTuiModel(session, { loopRunner }),
  );
  const [, rerender] = useState(0);

  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit?.();
      return;
    }

    const command = commandForHotkey(input);
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
