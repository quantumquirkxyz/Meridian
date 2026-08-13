import type { Stage } from "@agents/shared";

/**
 * Definition of the trading cycle: its start, progression, and completion path.
 *
 * The cycle starts at `signals`, progresses through the operating model flow,
 * and ends at `complete`. Specialized agent logic is deliberately out of scope
 * here: the cycle only defines the path.
 */
export class TradingCycle {
  static readonly START: Stage = "signals";
  static readonly COMPLETE: Stage = "complete";
  static readonly STAGES: readonly Stage[] = [
    "hypotheses",
    "plans",
    "execution",
    "outcome",
    "learning",
  ];

  /** The full ordered path from start to completion. */
  get progression(): readonly Stage[] {
    return [TradingCycle.START, ...TradingCycle.STAGES, TradingCycle.COMPLETE];
  }

  /** The stage following `stage`, or `null` after completion. */
  next(stage: Stage): Stage | null {
    const progression = this.progression;
    const index = progression.indexOf(stage);
    return index >= 0 && index + 1 < progression.length ? progression[index + 1] : null;
  }
}