import { describe, expect, test } from "bun:test";
import {
  BetaControlTuiModel,
  commandForHotkey,
  type BetaControlCommand,
  type BetaControlPort,
  type BetaControlPortStatus,
  type BetaLoopRunner,
} from "../src/control-tui.ts";

function fakeSession(): BetaControlPort {
  let status: BetaControlPortStatus = {
    running: false,
    mode: "NORMAL",
    state: "IDLE",
    killSwitchActive: false,
    openOrders: 0,
    reportCount: 0,
  };
  return {
    get status() {
      return status;
    },
    control(command: BetaControlCommand) {
      if (command === "start" && status.mode !== "NORMAL") {
        throw new Error(`cannot start from defensive mode ${status.mode}`);
      }
      if (command === "start") {
        status = { ...status, running: true };
      } else if (command === "stop") {
        status = { ...status, running: false };
      } else if (command === "halt") {
        status = {
          ...status,
          running: false,
          mode: "HALT",
          state: "HALT",
          killSwitchActive: true,
        };
      } else if (command === "reduce-only") {
        status = {
          ...status,
          running: false,
          mode: "REDUCE_ONLY",
          state: "REDUCE_ONLY_MODE",
        };
      } else if (command === "cancel-all") {
        status = {
          ...status,
          running: false,
          mode: "CANCEL_ONLY",
          state: "CANCEL_ONLY_MODE",
        };
      } else if (command === "cash-only") {
        status = {
          ...status,
          running: false,
          mode: "CASH_ONLY",
          state: "CASH_ONLY_MODE",
        };
      }
      return { command, ...status };
    },
  };
}

function fakeLoopRunner(events: string[]): BetaLoopRunner {
  return {
    start() {
      events.push("start");
    },
    stop() {
      events.push("stop");
    },
  };
}

describe("BetaControlTuiModel (issue #33)", () => {
  test("maps TUI commands to session controls and renders operator state", () => {
    const events: string[] = [];
    const tui = new BetaControlTuiModel(fakeSession(), {
      loopRunner: fakeLoopRunner(events),
    });

    expect(tui.render()).toContain("Meridian Beta Control");
    expect(tui.view.commandRows.map((row) => row.command)).toEqual([
      "start",
      "stop",
      "cancel-all",
      "cash-only",
      "reduce-only",
      "halt",
    ]);
    expect(commandForHotkey("s")).toBe("start");
    expect(commandForHotkey("h")).toBe("halt");

    expect(tui.dispatch("start")).toMatchObject({
      command: "start",
      running: true,
      mode: "NORMAL",
    });
    expect(events).toEqual(["start"]);
    expect(tui.dispatch("reduce-only")).toMatchObject({
      command: "reduce-only",
      running: false,
      mode: "REDUCE_ONLY",
    });

    expect(tui.view.statusRows).toContainEqual({
      label: "mode",
      value: "REDUCE_ONLY",
      emphasis: "warning",
    });
    expect(() => tui.dispatch("start")).toThrow(/defensive mode REDUCE_ONLY/);
    expect(tui.render()).toContain(
      "cannot start from defensive mode REDUCE_ONLY",
    );
  });

  test("renders kill-switch state as dangerous and stops the loop runner", () => {
    const events: string[] = [];
    const tui = new BetaControlTuiModel(fakeSession(), {
      loopRunner: fakeLoopRunner(events),
    });

    expect(tui.dispatch("start").mode).toBe("NORMAL");
    expect(tui.dispatch("halt")).toMatchObject({
      command: "halt",
      running: false,
      mode: "HALT",
      killSwitchActive: true,
    });
    expect(tui.view.statusRows).toContainEqual({
      label: "kill switch",
      value: "active",
      emphasis: "danger",
    });
    expect(tui.view.commandRows.find((row) => row.command === "halt")).toEqual(
      expect.objectContaining({ dangerous: true }),
    );
  });
});
