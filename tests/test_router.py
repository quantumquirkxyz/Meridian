from quant.agents.router import Router
from quant.core.context import CycleReport, Signal
from quant.core.stages import Stage


def test_router_is_the_explicit_entry_point_and_completes():
    router = Router()

    report = router.run([Signal(venue="Binance", symbol="BTCUSDT", read="momentum up")])

    assert isinstance(report, CycleReport)
    assert report.completed is True
    assert report.stages == [
        Stage.SIGNALS,
        Stage.HYPOTHESES,
        Stage.PLANS,
        Stage.EXECUTION,
        Stage.OUTCOME,
        Stage.LEARNING,
        Stage.COMPLETE,
    ]


def test_router_routes_registered_agents_to_their_supported_stage():
    calls = []

    class RecordingAgent:
        name = "recorder"
        stages = (Stage.HYPOTHESES,)

        def supports(self, stage):
            return stage in self.stages

        def act(self, stage, context):
            calls.append((self.name, stage))

    router = Router(agents=[RecordingAgent()])
    router.run([Signal(venue="Uniswap", symbol="ETHUSDT", read="liquidity thin")])

    assert calls == [("recorder", Stage.HYPOTHESES)]


def test_router_run_without_agents_still_completes():
    router = Router(agents=[])

    report = router.run([Signal(venue="Binance", symbol="BTCUSDT", read="momentum up")])

    assert report.completed is True
    assert report.context.hypotheses == []
