from quant.agents.router import Router
from quant.agents.stubs import DEFAULT_AGENTS
from quant.core.context import Hypothesis, Signal


def test_default_stub_agents_complete_the_cycle_end_to_end():
    router = Router()

    report = router.run([Signal(venue="Binance", symbol="BTCUSDT", read="momentum up")])

    assert report.completed is True
    assert len(report.context.hypotheses) == len(
        [a for a in DEFAULT_AGENTS if a.name in ("Research", "MarketReading", "Arbitrage")]
    )
    assert len(report.context.plans) == len(
        [a for a in DEFAULT_AGENTS if a.name in ("Risk", "Portfolio", "Compliance")]
    )
    assert len(report.context.executions) == len(
        [a for a in DEFAULT_AGENTS if a.name == "Execution"]
    )
    assert report.context.outcomes == []
    assert report.context.learnings == []


def test_agents_are_pluggable_replacing_a_stub():
    class CustomResearch:
        name = "Research"
        stages = ("hypotheses",)

        def supports(self, stage):
            return stage == "hypotheses"

        def act(self, stage, context):
            context.hypotheses.append(Hypothesis(agent=self.name, summary="custom read"))

    router = Router(agents=[CustomResearch()])

    report = router.run([Signal(venue="Binance", symbol="BTCUSDT", read="momentum up")])

    assert report.completed is True
    assert report.context.hypotheses == [Hypothesis(agent="Research", summary="custom read")]
