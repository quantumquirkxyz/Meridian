import { describe, expect, test } from "bun:test";

import type { CycleContext, Signal, Stage } from "@agents/shared";

import { DEFAULT_AGENTS } from "../src/agents.js";
import { TradingCycle } from "../src/cycle.js";
import { Router } from "../src/router.js";

const signal: Signal = { venue: "Binance", symbol: "BTCUSDT", read: "momentum up" };

describe("TradingCycle", () => {
  test("defines start, progression, and completion path", () => {
    const cycle = new TradingCycle();
    expect(cycle.progression).toEqual([
      "signals",
      "hypotheses",
      "plans",
      "execution",
      "outcome",
      "learning",
      "complete",
    ]);
  });

  test("next moves forward one stage and stops after complete", () => {
    const cycle = new TradingCycle();
    expect(cycle.next("signals")).toBe("hypotheses");
    expect(cycle.next("learning")).toBe("complete");
    expect(cycle.next("complete")).toBeNull();
  });
});

describe("Router", () => {
  test("is the explicit entry point and completes the cycle", () => {
    const router = new Router();
    const report = router.run([signal]);

    expect(report.completed).toBe(true);
    expect(report.stages).toEqual([
      "signals",
      "hypotheses",
      "plans",
      "execution",
      "outcome",
      "learning",
      "complete",
    ]);
  });

  test("routes registered agents to their supported stage", () => {
    const calls: Array<[string, Stage]> = [];
    const recorder = {
      name: "recorder",
      stages: ["hypotheses"] as readonly Stage[],
      supports: (stage: Stage) => stage === "hypotheses",
      act: (stage: Stage) => {
        calls.push([recorder.name, stage]);
      },
    };

    const router = new Router([recorder]);
    router.run([signal]);

    expect(calls).toEqual([["recorder", "hypotheses"]]);
  });

  test("runs without agents and still completes", () => {
    const router = new Router([]);
    const report = router.run([signal]);

    expect(report.completed).toBe(true);
    expect(report.context.hypotheses).toEqual([]);
  });

  test("default stub agents complete the cycle end to end", () => {
    const router = new Router();
    const report = router.run([signal]);

    const hypothesisAgents = DEFAULT_AGENTS.filter((agent) =>
      agent.stages.includes("hypotheses"),
    );
    const planAgents = DEFAULT_AGENTS.filter((agent) =>
      agent.stages.includes("plans"),
    );
    const executionAgents = DEFAULT_AGENTS.filter((agent) =>
      agent.stages.includes("execution"),
    );
    expect(report.context.hypotheses).toHaveLength(hypothesisAgents.length);
    expect(report.context.plans).toHaveLength(planAgents.length);
    expect(report.context.executions).toHaveLength(executionAgents.length);
    expect(report.context.outcomes).toEqual([]);
    expect(report.context.learnings).toEqual([]);
  });

  test("agents are pluggable, replacing a stub", () => {
    const customResearch = {
      name: "Research",
      stages: ["hypotheses"] as readonly Stage[],
      supports: (stage: Stage) => stage === "hypotheses",
      act: (_stage: Stage, context: CycleContext) => {
        context.hypotheses.push({ agent: "Research", summary: "custom read" });
      },
    };

    const router = new Router([customResearch]);
    const report = router.run([signal]);

    expect(report.context.hypotheses).toEqual([
      { agent: "Research", summary: "custom read" },
    ]);
  });
});