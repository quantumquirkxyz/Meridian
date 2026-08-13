"""Default stub agents that let the cycle complete before specialized logic exists."""

from __future__ import annotations

from quant.agents.base import Agent
from quant.core.context import (
    CycleContext,
    Execution,
    Hypothesis,
    Learning,
    Outcome,
    Plan,
)
from quant.core.stages import Stage


class StubAgent:
    """A minimal placeholder agent that records participation in a stage.

    Later tickets replace each role stub with a real agent at the same seam:
    implement :class:`quant.agents.base.Agent` and register it with the router.
    """

    name: str
    stages: tuple[Stage, ...]

    def __init__(self, name: str, stage: Stage) -> None:
        self.name = name
        self.stages = (stage,)

    def supports(self, stage: Stage) -> bool:
        return stage in self.stages

    def act(self, stage: Stage, context: CycleContext) -> None:
        summary = f"{self.name} contributed at {stage.value}"
        if stage is Stage.HYPOTHESES:
            context.hypotheses.append(Hypothesis(agent=self.name, summary=summary))
        elif stage is Stage.PLANS:
            context.plans.append(Plan(agent=self.name, summary=summary))
        elif stage is Stage.EXECUTION:
            context.executions.append(Execution(agent=self.name, summary=summary))
        elif stage is Stage.OUTCOME:
            context.outcomes.append(Outcome(agent=self.name, summary=summary))
        elif stage is Stage.LEARNING:
            context.learnings.append(Learning(agent=self.name, summary=summary))


DEFAULT_AGENTS: tuple[Agent, ...] = (
    StubAgent("Research", Stage.HYPOTHESES),
    StubAgent("MarketReading", Stage.HYPOTHESES),
    StubAgent("Arbitrage", Stage.HYPOTHESES),
    StubAgent("Risk", Stage.PLANS),
    StubAgent("Portfolio", Stage.PLANS),
    StubAgent("Compliance", Stage.PLANS),
    StubAgent("Execution", Stage.EXECUTION),
    StubAgent("Outcome", Stage.OUTCOME),
    StubAgent("Learning", Stage.LEARNING),
)
