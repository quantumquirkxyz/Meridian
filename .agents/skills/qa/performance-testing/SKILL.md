# performance-testing

Design and execute performance tests — load, stress, soak, spike — to validate latency, throughput, and resource consumption under realistic conditions.

## Goals
- Validate performance SLIs (latency, throughput, error rate)
- Identify bottlenecks before users encounter them
- Set performance baselines and regression thresholds
- Report actionable findings with evidence

## Contract

### Input
A system to test: endpoints, expected load, performance targets.

### Output
A performance test report with:
- Baseline metrics (latency, throughput, resource usage)
- Bottleneck analysis and recommendations
- Regression thresholds for CI

## Test Types

| Type | Goal | Duration |
|---|---|---|
| Load test | Validate SLA at expected load | 15–60 min |
| Stress test | Find breaking point | Until failure |
| Soak test | Detect memory leaks | 2–8 hours |
| Spike test | Measure recovery | Minutes |
| Smoke test | Quick sanity check | 2–5 min |

## Metrics

- **Latency**: p50, p95, p99 response time
- **Throughput**: requests/second
- **Error rate**: % of failed requests
- **Resource**: CPU, memory, I/O, network

## Steps

1. **Define SLIs and targets** — what is "fast enough"
2. **Create test scenarios** — representative user journeys
3. **Set up test environment** — mirror production configuration
4. **Run baseline tests** — measure under normal conditions
5. **Stress incrementally** — increase load until breaking point
6. **Analyze results** — find bottlenecks, graph correlations
7. **Set regression thresholds** — gate CI on performance

## References
- `../qa-automation/SKILL.md` — test infrastructure
- `../../platform/monitoring-alerting/SKILL.md` — metrics collection
- `../../delivery/webapp-testing/SKILL.md` — e2e testing
