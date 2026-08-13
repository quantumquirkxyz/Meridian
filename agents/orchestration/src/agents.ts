import type { CycleContext, Stage } from "@agents/shared";

/** A role that contributes to the trading cycle at one or more stages. */
export interface Agent {
  readonly name: string;
  readonly stages: readonly Stage[];
  supports(stage: Stage): boolean;
  act(stage: Stage, context: CycleContext): void;
}

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
    const summary = `${this.name} contributed at ${stage}`;
    switch (stage) {
      case "hypotheses":
        context.hypotheses.push({ agent: this.name, summary });
        break;
      case "plans":
        context.plans.push({ agent: this.name, summary });
        break;
      case "execution":
        context.executions.push({ agent: this.name, summary });
        break;
      case "outcome":
        context.outcomes.push({ agent: this.name, summary });
        break;
      case "learning":
        context.learnings.push({ agent: this.name, summary });
        break;
      default:
        break;
    }
  }
}

export const DEFAULT_AGENTS: readonly Agent[] = [
  new StubAgent("Research", ["hypotheses"]),
  new StubAgent("MarketReading", ["hypotheses"]),
  new StubAgent("Arbitrage", ["hypotheses"]),
  new StubAgent("Risk", ["plans"]),
  new StubAgent("Portfolio", ["plans"]),
  new StubAgent("Compliance", ["plans"]),
  new StubAgent("Execution", ["execution"]),
  new StubAgent("Outcome", ["outcome"]),
  new StubAgent("Learning", ["learning"]),
];