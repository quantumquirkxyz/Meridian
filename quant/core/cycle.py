"""Definition of the trading cycle: its start, progression, and completion path."""

from __future__ import annotations

from quant.core.stages import Stage


class TradingCycle:
    """Defines the fixed shape of the router-led trading cycle.

    The cycle starts at :data:`Stage.SIGNALS`, progresses through the operating
    model flow, and ends at :data:`Stage.COMPLETE`. Specialized agent logic is
    deliberately out of scope here: the cycle only defines the path.
    """

    START: Stage = Stage.SIGNALS
    COMPLETE: Stage = Stage.COMPLETE
    STAGES: tuple[Stage, ...] = (
        Stage.HYPOTHESES,
        Stage.PLANS,
        Stage.EXECUTION,
        Stage.OUTCOME,
        Stage.LEARNING,
    )

    @property
    def progression(self) -> tuple[Stage, ...]:
        """The full ordered path from start to completion."""
        return (self.START,) + self.STAGES + (self.COMPLETE,)

    def next(self, stage: Stage) -> Stage | None:
        """Return the stage following ``stage``, or ``None`` after completion."""
        progression = self.progression
        index = progression.index(stage)
        if index + 1 < len(progression):
            return progression[index + 1]
        return None
