import type { Signal, Stage, StageTransition } from "@agents/shared";

import type { Agent } from "./agents.js";
import { DEFAULT_AGENTS } from "./agents.js";
import { TradingCycle } from "./cycle.js";
import { CycleContext, CycleReport } from "./context.js";

/**
 * The Router / Coordinator: the explicit entry point for the trading cycle.
 *
 * The router orders agent execution, aggregates outputs, and drives the cycle
 * through its progression until the completion path is reached.
 */
export class Router {
  private readonly agents: Agent[];
  private readonly cycle: TradingCycle;

  constructor(agents?: Iterable<Agent>, cycle?: TradingCycle) {
    this.agents = agents ? [...agents] : [...DEFAULT_AGENTS];
    this.cycle = cycle ?? new TradingCycle();
  }

  /** Agents that support `stage`. */
  agentsFor(stage: Stage): Agent[] {
    return this.agents.filter((agent) => agent.supports(stage));
  }

  /**
   * Run the cycle from signals through to completion.
   *
   * The Router / Coordinator is the explicit entry point: callers hand in
   * signals and receive a completed {@link CycleReport}.
   */
  run(signals: Signal[]): CycleReport {
    const context = new CycleContext();
    context.signals.push(...signals);
    const transitions: StageTransition[] = [{ stage: TradingCycle.START }];
    for (const stage of TradingCycle.STAGES) {
      for (const agent of this.agentsFor(stage)) {
        agent.act(stage, context);
      }
      transitions.push({ stage });
    }
    transitions.push({ stage: TradingCycle.COMPLETE });
    return new CycleReport(context, transitions);
  }
}