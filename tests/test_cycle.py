from quant.core.cycle import TradingCycle
from quant.core.stages import Stage


def test_cycle_defines_start_progression_and_completion_path():
    cycle = TradingCycle()

    assert cycle.START is Stage.SIGNALS
    assert cycle.COMPLETE is Stage.COMPLETE
    assert cycle.progression == (
        Stage.SIGNALS,
        Stage.HYPOTHESES,
        Stage.PLANS,
        Stage.EXECUTION,
        Stage.OUTCOME,
        Stage.LEARNING,
        Stage.COMPLETE,
    )


def test_cycle_next_moves_forward_one_stage_and_stops_after_complete():
    cycle = TradingCycle()

    assert cycle.next(Stage.SIGNALS) is Stage.HYPOTHESES
    assert cycle.next(Stage.LEARNING) is Stage.COMPLETE
    assert cycle.next(Stage.COMPLETE) is None
