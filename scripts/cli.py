"""quant-trade command line interface."""

from __future__ import annotations

import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="quant-trade", description="Multi-agent live trading system"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser(
        "run",
        help="Run the router-led trading cycle skeleton with sample signals (alias for run-cycle)",
    )
    subparsers.add_parser(
        "run-cycle",
        help="Run the router-led trading cycle skeleton with sample signals",
    )
    return parser


def run_cycle() -> None:
    from quant.agents.router import Router
    from quant.core.context import Signal

    router = Router()
    report = router.run(
        [
            Signal(venue="Binance", symbol="BTCUSDT", read="momentum up"),
            Signal(venue="Uniswap", symbol="ETHUSDT", read="liquidity thin"),
        ]
    )
    print(f"Cycle {'completed' if report.completed else 'incomplete'}")
    print("Stages: " + " -> ".join(stage.value for stage in report.stages))
    print(f"Signals: {len(report.context.signals)}")
    print(f"Hypotheses: {len(report.context.hypotheses)}")
    print(f"Plans: {len(report.context.plans)}")
    print(f"Executions: {len(report.context.executions)}")
    print(f"Outcomes: {len(report.context.outcomes)}")
    print(f"Learnings: {len(report.context.learnings)}")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command in {"run", "run-cycle"}:
        run_cycle()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
