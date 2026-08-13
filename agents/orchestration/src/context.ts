import {
  STAGES,
  type CycleContext as CycleContextShape,
  type CycleReport as CycleReportShape,
  type Execution,
  type Hypothesis,
  type Learning,
  type Outcome,
  type Plan,
  type Signal,
  type Stage,
  type StageTransition,
} from "@agents/shared";

/** Accumulates the artifacts produced across the cycle's stages. */
export class CycleContext implements CycleContextShape {
  signals: Signal[] = [];
  hypotheses: Hypothesis[] = [];
  plans: Plan[] = [];
  executions: Execution[] = [];
  outcomes: Outcome[] = [];
  learnings: Learning[] = [];
}

/** The completion report produced when a cycle reaches its completion path. */
export class CycleReport implements CycleReportShape {
  constructor(
    readonly context: CycleContext,
    readonly transitions: StageTransition[],
  ) {}

  get stages(): Stage[] {
    return this.transitions.map((transition) => transition.stage);
  }

  get completed(): boolean {
    return (
      this.transitions.length > 0 &&
      this.transitions[this.transitions.length - 1].stage === STAGES[STAGES.length - 1]
    );
  }
}