import { STAGES, type Stage } from "@agents/shared";

/**
 * Definition of the trading cycle: its start, progression, and completion path.
 *
 * The cycle starts at `signals`, progresses through the operating model flow,
 * and ends at `complete`. Specialized agent logic is deliberately out of scope
 * here: the cycle only defines the path. The stage vocabulary is derived from
 * the single `STAGES` const in `@agents/shared` so nothing is re-declared.
 */
export class TradingCycle {
  static readonly START: Stage = STAGES[0];
  static readonly COMPLETE: Stage = STAGES[STAGES.length - 1];
  static readonly MIDDLE_STAGES: readonly Stage[] = STAGES.filter(
    (stage) => stage !== STAGES[0] && stage !== STAGES[STAGES.length - 1],
  );

  /** The full ordered path from start to completion. */
  get progression(): readonly Stage[] {
    return [
      TradingCycle.START,
      ...TradingCycle.MIDDLE_STAGES,
      TradingCycle.COMPLETE,
    ];
  }
}