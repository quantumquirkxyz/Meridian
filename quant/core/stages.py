"""Decision stages of the trading cycle."""

from enum import Enum


class Stage(str, Enum):
    """A stage in the router-led trading cycle.

    Values follow the operating model flow:
    ``signals -> hypotheses -> plans -> execution -> outcome -> learning``.
    """

    SIGNALS = "signals"
    HYPOTHESES = "hypotheses"
    PLANS = "plans"
    EXECUTION = "execution"
    OUTCOME = "outcome"
    LEARNING = "learning"
    COMPLETE = "complete"
