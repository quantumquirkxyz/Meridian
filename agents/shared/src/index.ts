/**
 * Shared schemas for the trading cycle and its agents.
 *
 * The stage vocabulary follows the operating model flow:
 * `signals -> hypotheses -> plans -> execution -> outcome -> learning`.
 */

export const STAGES = [
  "signals",
  "hypotheses",
  "plans",
  "execution",
  "outcome",
  "learning",
  "complete",
] as const;

export type Stage = (typeof STAGES)[number];

/** A market read or piece of evidence, not an order. */
export interface Signal {
  venue: string;
  symbol: string;
  read: string;
}

/** A candidate trade idea produced from signals. */
export interface Hypothesis {
  agent: string;
  summary: string;
}

/** An approved route toward executable orders. */
export interface Plan {
  agent: string;
  summary: string;
}

/** An executable order or route. */
export interface Execution {
  agent: string;
  summary: string;
}

/** The observed result of an execution. */
export interface Outcome {
  agent: string;
  summary: string;
}

/** A memory note kept for later cycles. */
export interface Learning {
  agent: string;
  summary: string;
}

/** Accumulates the artifacts produced across the cycle's stages. */
export interface CycleContext {
  signals: Signal[];
  hypotheses: Hypothesis[];
  plans: Plan[];
  executions: Execution[];
  outcomes: Outcome[];
  learnings: Learning[];
}

/** A single recorded entry into a cycle stage. */
export interface StageTransition {
  stage: Stage;
}

/** The completion report produced when a cycle reaches its completion path. */
export interface CycleReport {
  context: CycleContext;
  transitions: StageTransition[];
  readonly stages: Stage[];
  readonly completed: boolean;
}
