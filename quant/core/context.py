"""State carried through the trading cycle and the cycle's output report."""

from __future__ import annotations

from dataclasses import dataclass, field

from quant.core.stages import Stage


@dataclass(frozen=True)
class Signal:
    """A market read or piece of evidence, not an order."""

    venue: str
    symbol: str
    read: str


@dataclass(frozen=True)
class Hypothesis:
    """A candidate trade idea produced from signals."""

    agent: str
    summary: str


@dataclass(frozen=True)
class Plan:
    """An approved route toward executable orders."""

    agent: str
    summary: str


@dataclass(frozen=True)
class Execution:
    """An executable order or route."""

    agent: str
    summary: str


@dataclass(frozen=True)
class Outcome:
    """The observed result of an execution."""

    agent: str
    summary: str


@dataclass(frozen=True)
class Learning:
    """A memory note kept for later cycles."""

    agent: str
    summary: str


@dataclass
class CycleContext:
    """Accumulates the artifacts produced across the cycle's stages."""

    signals: list[Signal] = field(default_factory=list)
    hypotheses: list[Hypothesis] = field(default_factory=list)
    plans: list[Plan] = field(default_factory=list)
    executions: list[Execution] = field(default_factory=list)
    outcomes: list[Outcome] = field(default_factory=list)
    learnings: list[Learning] = field(default_factory=list)


@dataclass(frozen=True)
class StageTransition:
    """A single recorded entry into a cycle stage."""

    stage: Stage


@dataclass
class CycleReport:
    """The completion report produced when a cycle reaches its completion path."""

    context: CycleContext
    transitions: list[StageTransition] = field(default_factory=list)

    @property
    def stages(self) -> list[Stage]:
        return [transition.stage for transition in self.transitions]

    @property
    def completed(self) -> bool:
        return bool(self.transitions) and self.transitions[-1].stage is Stage.COMPLETE

    @property
    def complete_reached_at(self) -> StageTransition | None:
        for transition in self.transitions:
            if transition.stage is Stage.COMPLETE:
                return transition
        return None
