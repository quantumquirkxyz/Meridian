"""Agent contract for the trading cycle.

Specialized agents (Research, Market Reading, Arbitrage, Risk, Portfolio,
Compliance, Execution) plug into the cycle by implementing :class:`Agent`.
"""

from __future__ import annotations

from typing import Protocol

from quant.core.context import CycleContext
from quant.core.stages import Stage


class Agent(Protocol):
    """A role that contributes to the trading cycle at one or more stages."""

    name: str
    stages: tuple[Stage, ...]

    def supports(self, stage: Stage) -> bool:
        """Whether this agent acts at ``stage``."""
        ...

    def act(self, stage: Stage, context: CycleContext) -> None:
        """Contribute to ``context`` during ``stage``."""
        ...
