"""The Router / Coordinator: the explicit entry point for the trading cycle.

The router orders agent execution, aggregates outputs, and drives the cycle
through its progression until the completion path is reached.
"""

from __future__ import annotations

from collections.abc import Iterable

from quant.agents.base import Agent
from quant.agents.stubs import DEFAULT_AGENTS
from quant.core.context import CycleContext, CycleReport, Signal, StageTransition
from quant.core.cycle import TradingCycle
from quant.core.stages import Stage


class Router:
    """Routes each stage to the agents that support it and runs the cycle."""

    def __init__(
        self,
        agents: Iterable[Agent] | None = None,
        cycle: TradingCycle | None = None,
    ) -> None:
        self._agents: list[Agent] = list(agents if agents is not None else DEFAULT_AGENTS)
        self._cycle = cycle if cycle is not None else TradingCycle()

    def register(self, agent: Agent) -> None:
        """Register an agent so it contributes to the stages it supports."""
        self._agents.append(agent)

    def agents_for(self, stage: Stage) -> list[Agent]:
        return [agent for agent in self._agents if agent.supports(stage)]

    def run(self, signals: Iterable[Signal]) -> CycleReport:
        """Run the cycle from signals through to completion.

        The Router / Coordinator is the explicit entry point: callers hand in
        signals and receive a completed :class:`CycleReport`.
        """
        context = CycleContext(signals=list(signals))
        transitions = [StageTransition(self._cycle.START)]
        for stage in self._cycle.STAGES:
            for agent in self.agents_for(stage):
                agent.act(stage, context)
            transitions.append(StageTransition(stage))
        transitions.append(StageTransition(self._cycle.COMPLETE))
        return CycleReport(context=context, transitions=transitions)
