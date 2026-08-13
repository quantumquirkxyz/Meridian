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
    MIDDLE_STAGES: tuple[Stage, ...] = tuple(
        stage for stage in Stage if stage not in {Stage.SIGNALS, Stage.COMPLETE}
    )

    @property
    def progression(self) -> tuple[Stage, ...]:
        """The full ordered path from start to completion."""
        return (self.START,) + self.MIDDLE_STAGES + (self.COMPLETE,)
