import { describe, expect, test } from "bun:test";
import { BetaPaperTradingSession } from "../../core/src/index.ts";
import { BetaControlTuiModel } from "../src/control-tui.ts";

const FIXED_TS = 1_700_000_000_000;

describe("BetaControlTuiModel (issue #33)", () => {
  test("maps minimal TUI commands to paper-session controls", () => {
    const session = new BetaPaperTradingSession({ now: () => FIXED_TS });
    const tui = new BetaControlTuiModel(session);

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
    expect(tui.dispatch("start")).toMatchObject({
      running: true,
      mode: "PAPER_ONLY",
    });
    expect(tui.dispatch("halt")).toMatchObject({
      command: "halt",
      running: false,
      mode: "HALT",
      killSwitchActive: true,
    });
  });
});
