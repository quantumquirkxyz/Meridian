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
class Artifact:
    """A single contribution produced by an agent at a cycle stage."""

    agent: str
    summary: str


# Domain-named aliases keep the glossary vocabulary while sharing one shape.
Hypothesis = Artifact
Plan = Artifact
Execution = Artifact
Outcome = Artifact
Learning = Artifact


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
