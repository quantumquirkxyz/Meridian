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

/** A single contribution produced by an agent at a cycle stage. */
export interface Artifact {
  agent: string;
  summary: string;
}

// Domain-named aliases keep the glossary vocabulary while sharing one shape.
/** A candidate trade idea produced from signals. */
export type Hypothesis = Artifact;

/** An approved route toward executable orders. */
export type Plan = Artifact;

/** An executable order or route. */
export type Execution = Artifact;

/** The observed result of an execution. */
export type Outcome = Artifact;

/** A memory note kept for later cycles. */
export type Learning = Artifact;

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
