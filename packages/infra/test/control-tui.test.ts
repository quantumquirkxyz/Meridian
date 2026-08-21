import { describe, expect, test } from "bun:test";
import { BetaPaperTradingSession } from "../../core/src/index.ts";
import { BetaControlTuiModel } from "../src/control-tui.ts";

const FIXED_TS = 1_700_000_000_000;

describe("BetaControlTuiModel (issue #33)", () => {
  test("maps TUI commands to paper-session controls and renders operator state", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });
    const tui = new BetaControlTuiModel(session);

    expect(tui.render()).toContain("Meridian Beta Paper Control");
    expect(tui.view.commandRows.map((row) => row.command)).toEqual([
      "start",
      "stop",
      "cancel-all",
      "cash-only",
      "reduce-only",
      "halt",
    ]);
    expect(tui.dispatch("start")).toMatchObject({
      command: "start",
      running: true,
      mode: "PAPER_ONLY",
    });
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

  test("renders kill-switch state as dangerous", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });
    const tui = new BetaControlTuiModel(session);

    expect(tui.dispatch("start").mode).toBe("PAPER_ONLY");
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
