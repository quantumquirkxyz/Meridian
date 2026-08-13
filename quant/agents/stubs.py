"""Default stub agents that let the cycle complete before specialized logic exists."""

from __future__ import annotations

from collections.abc import Callable

from quant.agents.base import Agent
from quant.core.context import Artifact, CycleContext
from quant.core.stages import Stage

APPENDER = Callable[[CycleContext, Artifact], None]

# Stage -> typed append on CycleContext. Appending to the right bucket is data,
# not a branch, and a stage's bucket cannot be misspelled at runtime.
ARTIFACT_BUCKETS: dict[Stage, APPENDER] = {
    Stage.HYPOTHESES: lambda context, artifact: context.hypotheses.append(artifact),
    Stage.PLANS: lambda context, artifact: context.plans.append(artifact),
    Stage.EXECUTION: lambda context, artifact: context.executions.append(artifact),
    Stage.OUTCOME: lambda context, artifact: context.outcomes.append(artifact),
    Stage.LEARNING: lambda context, artifact: context.learnings.append(artifact),
}


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
        append = ARTIFACT_BUCKETS.get(stage)
        if append is None:
            return
        append(
            context,
            Artifact(
                agent=self.name,
                summary=f"{self.name} contributed at {stage.value}",
            ),
        )


DEFAULT_AGENTS: tuple[Agent, ...] = (
    StubAgent("Research", Stage.HYPOTHESES),
    StubAgent("MarketReading", Stage.HYPOTHESES),
    StubAgent("Arbitrage", Stage.HYPOTHESES),
    StubAgent("Risk", Stage.PLANS),
    StubAgent("Portfolio", Stage.PLANS),
    StubAgent("Compliance", Stage.PLANS),
    StubAgent("Execution", Stage.EXECUTION),
)
