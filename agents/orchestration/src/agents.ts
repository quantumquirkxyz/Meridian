import { STAGES, type CycleContext, type Stage } from "@agents/shared";

/** A role that contributes to the trading cycle at one or more stages. */
export interface Agent {
  readonly name: string;
  readonly stages: readonly Stage[];
  supports(stage: Stage): boolean;
  act(stage: Stage, context: CycleContext): void;
}

const [, HYPOTHESES, PLANS, EXECUTION, OUTCOME, LEARNING] = STAGES;

type ArtifactBucket = "hypotheses" | "plans" | "executions" | "outcomes" | "learnings";

/** Stage -> CycleContext bucket name. Appending to the right bucket is data, not a branch. */
const ARTIFACT_BUCKETS: Partial<Record<Stage, ArtifactBucket>> = {
  [HYPOTHESES]: "hypotheses",
  [PLANS]: "plans",
  [EXECUTION]: "executions",
  [OUTCOME]: "outcomes",
  [LEARNING]: "learnings",
};

/**
 * A minimal placeholder agent that records participation in a stage.
 *
 * Later tickets replace each role stub with a real agent at the same seam:
 * implement {@link Agent} and register it with the router.
 */
export class StubAgent implements Agent {
  constructor(
    readonly name: string,
    readonly stages: readonly Stage[],
  ) {}

  supports(stage: Stage): boolean {
    return this.stages.includes(stage);
  }

  act(stage: Stage, context: CycleContext): void {
    const bucket = ARTIFACT_BUCKETS[stage];
    if (bucket === undefined) {
      return;
    }
    context[bucket].push({
      agent: this.name,
      summary: `${this.name} contributed at ${stage}`,
    });
  }
}

export const DEFAULT_AGENTS: readonly Agent[] = [
  new StubAgent("Research", [HYPOTHESES]),
  new StubAgent("MarketReading", [HYPOTHESES]),
  new StubAgent("Arbitrage", [HYPOTHESES]),
  new StubAgent("Risk", [PLANS]),
  new StubAgent("Portfolio", [PLANS]),
  new StubAgent("Compliance", [PLANS]),
  new StubAgent("Execution", [EXECUTION]),
];