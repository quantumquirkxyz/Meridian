# Project Context

## 1. Structural transformation of crypto trading

The crypto market is no longer an environment of isolated exchanges; it has become a fragmented network of liquidity, execution, custody, settlement, and data. This network hosts centralized markets, known as **CEXs**, and decentralized markets, known as **DEXs**. CEXs concentrate market depth, execution speed, professional infrastructure, standardized APIs, and highly liquid derivative products. DEXs, in turn, offer on-chain settlement, permissionless access, transactional transparency, and new forms of price formation via AMMs, on-chain order books, RFQ, intents, aggregators, and decentralized perpetual protocols.

This convergence has created a hybrid market structure where liquidity no longer lives in a single venue but is distributed across multiple layers: centralized order books, AMM pools, perpetual DEXs, bridges, L2s, rollups, custodians, market makers, aggregators, and execution networks. In 2025, market reports highlighted that CEXs still dominated aggregate volume, but DEXs gained significant share, especially in spot and on-chain derivatives, showing that the market is moving toward a more multi-venue and programmable architecture.

## 2. Liquidity fragmentation as the source of algorithmic opportunity

Liquidity fragmentation is the central phenomenon that justifies the system. The same asset can trade simultaneously on Bybit, Binance, OKX, Coinbase, Hyperliquid, Uniswap, Curve, PancakeSwap, Raydium, Jupiter, GMX, and other venues. Each venue has its own price formation mechanism, depth, latency, fees, funding, slippage, available inventory, and execution risk.

This fragmentation generates temporary inefficiencies: price differences between CEXs, between DEXs, between CEX and DEX, and between chains. In practical terms, these differences can manifest as spatial arbitrage, triangular arbitrage, basis trading, funding arbitrage, latency arbitrage, cross-chain arbitrage, or intelligent order execution. Recent studies on CEX–DEX arbitrage analyze precisely how differences between AMMs and centralized order books can be exploited, although real profits depend on frictions such as slippage, gas, latency, depth, and operational risk.

## 3. Fundamental difference between CEX and DEX

A **CEX** is financial infrastructure administered by a central entity. The exchange custodies funds, operates the matching engine, manages order books, provides private and public APIs, and offers products such as spot, margin, perpetual futures, options, and copy trading. Its main advantage is speed, liquidity, and user experience; its main disadvantages are counterparty risk, custody risk, jurisdictional restrictions, fund freezes, API limits, and dependence on closed infrastructure.

A **DEX** is on-chain infrastructure where execution happens through smart contracts. It may use AMMs, on-chain/off-chain order books, aggregators, intents, vaults, or hybrid systems. Its main advantage is transparent settlement and custody autonomy; its risks include smart contract vulnerabilities, MEV, network congestion, reorgs, bridge errors, extreme slippage, and public order exposure. In 2025, DeFi reports emphasized that routing, bridging, matching, and settlement are becoming invisible layers for the user, but they do not disappear as sources of technical risk.

## 4. Evolution toward multi-venue trading

Professional crypto trading can no longer be understood as buying or selling on a single exchange. Modern infrastructure operates across multiple venues and seeks the best combination of price, depth, risk, latency, and total execution cost. This implies continuously comparing CEXs, DEXs, bridges, blockchains, pools, order books, funding rates, and market conditions.

In a multi-venue system, each operation can have several possible paths. For example: buying an asset on a CEX and selling it on a DEX; buying on a DEX and selling on a CEX; arbitraging between two CEXs; arbitraging between two DEXs; hedging a spot exposure with a perpetual; capturing funding; balancing inventory between exchanges; or deciding not to execute because the total cost exceeds the expected advantage.

The technical context of the project is born from this need: to build infrastructure capable of observing, analyzing, deciding, and executing dynamically in a market where opportunity exists for seconds or milliseconds, and where an execution error can turn a theoretical opportunity into a real loss.

## 5. Exchange APIs as the programmatic access layer

APIs are the operational interface between the system and the exchanges. On CEXs such as Bybit, REST APIs allow querying balances, placing orders, canceling orders, modifying positions, querying history, and reading market data. WebSocket APIs provide real-time data on order books, trades, positions, fills, and state changes. Bybit V5, for example, unifies products such as spot, derivatives, and options under a common API, and its WebSockets support public streams for linear markets like USDT and USDC perpetuals.

This layer is critical because the system cannot depend on manual interaction. To operate algorithmically it needs persistent connectivity, authentication handling, rate-limit control, order reconciliation, fill confirmation, and state monitoring. Bybit's documentation indicates that order creation is asynchronous and that WebSocket must be used to confirm order state, which evidences the need to design an event-oriented architecture rather than only sequential REST requests.

## 6. Smart contracts as the decentralized execution layer

On DEXs, execution does not depend on a traditional centralized API, but on smart contracts, RPC providers, wallets, relayers, routers, aggregators, signers, mempools, and validators. This introduces a systemic difference: on a CEX, the main problem is interacting with a private matching engine; on a DEX, the main problem is building, simulating, signing, sending, and confirming on-chain transactions.

DEX execution demands considering gas, nonce management, slippage tolerance, token approval, swap routes, pool liquidity, oracles, MEV, block inclusion probability, and revert risk. In cross-chain arbitrage, the risk of bridges and the latency of transfers between networks also appear. Research on cross-chain arbitrage shows that many successful operations depend on pre-positioned inventory, while bridge-based routes introduce significantly higher latencies.

## 7. The need for a multi-agent architecture

A trading system that operates between CEXs and DEXs should not be designed as a monolithic bot. The complexity of the environment demands separation of responsibilities. This is where the multi-agent architecture arises: a set of specialized agents that collaborate, supervise each other, and execute distinct tasks under a common risk policy.

An agent can handle market data; another, signals; another, arbitrage; another, execution; another, inventory management; another, risk; another, compliance; another, audit; another, historical memory; and another, infrastructure monitoring. Recent literature on financial agents describes this transition from traditional algorithmic systems toward agentic systems, where components such as planner, orchestrator, alpha agents, risk agents, portfolio agents, execution agents, audit agents, and memory agents integrate as specialized modules.

## 8. AI Agents as the cognitive layer of the system

AI Agents do not replace deterministic trading logic; they add a cognitive layer for reasoning, classification, interpretation of context, prioritization of signals, failure diagnosis, and hypothesis generation. In low signal-to-noise markets such as crypto, this layer can help evaluate narratives, summarize information, analyze events, detect structural changes, and coordinate decisions between subsystems.

However, in a real trading system, LLM-based agents must not have unrestricted control over execution. Their role must be encapsulated by deterministic risk rules, validators, circuit breakers, and audit. Recent research in agents for investment emphasizes applications such as portfolio optimization, risk management, financial retrieval, and strategy generation, but also points to open challenges in interpretability, alignment, risk-sensitive design, and human integration in high-impact contexts.

## 9. Orchestration as the operating nervous system

Orchestration is the layer that coordinates agents, data, decisions, and actions. Without orchestration, agents can produce contradictory signals, execute redundant tasks, or compete for resources. In trading this is dangerous because it can generate over-exposure, duplicate orders, inventory errors, or out-of-sync executions.

A good orchestration layer defines priorities, dependencies, states, permissions, limits, fallback logic, and communication protocols. In engineering terms, it turns a set of agents into a coherent system. In financial terms, it turns multiple sources of signal into an executable decision with risk control. In operational terms, it ensures every action has traceability: which agent proposed it, which data justified it, which constraints were evaluated, and which outcome it produced.

Modern agent frameworks tend to model complex flows as interaction graphs between agents. This approach is useful because multi-venue trading is not linear: a signal can trigger liquidity validation, slippage calculation, balance verification, gas simulation, latency estimation, risk review, and finally execution or rejection.

## 10. Harness Engineering as the evaluation and control layer

In this context, **Harness Engineering** can be understood as the design of the experimental and operational harness that allows testing, containing, measuring, and controlling agents and algorithms. A harness is infrastructure that wraps system components to evaluate their behavior under reproducible scenarios.

For trading, this includes backtesting, paper trading, fill simulation, order book replay, slippage simulation, stress tests, disconnection tests, limit validation, API mocks, latency tests, and sandbox environments. Without a robust harness, the system may look profitable in theory but fail against real frictions: commissions, funding, execution queues, partial fills, API errors, liquidity changes, or divergence between expected and realized price.

The harness is especially important when using AI Agents, because their responses can vary with context, memory, prompt, and available tools. Therefore, each agent must be evaluated not only by its output, but by its consistency, reproducibility, operational safety, and ability to abstain when there is no sufficient statistical advantage.

## 11. Loop Engineering as the perception–decision–action–learning cycle

**Loop Engineering** refers to the explicit design of the system's closed loops. A trading system is not a single sequence; it is a continuous cycle of observation, analysis, decision, execution, monitoring, learning, and adjustment. Each loop must have frequency, tolerable latency, inputs, outputs, stopping criteria, and emergency conditions.

A data loop can operate in milliseconds or seconds. A risk loop can operate every time a position changes. A strategy loop can operate per candle, per event, or per volatility change. A learning loop can operate at session close, weekly, or after a certain number of trades. An audit loop can record every decision for later reconstruction.

The risk of not designing explicit loops is that the system becomes reactive and chaotic. In crypto markets, where volatility can behave like a diffusive process with abrupt jumps, loops must detect regime transitions: low to high volatility, deep to evaporated liquidity, trend to range, normal market to extreme event. The system must be able to change mode: trade, reduce exposure, hedge, cancel orders, or stay in cash.

## 12. Graph Engineering as a representation of markets, agents, and flows

**Graph Engineering** provides a natural way to represent the system. Multi-venue markets are graphs: nodes represent assets, exchanges, pools, chains, wallets, accounts, agents, or strategies; edges represent exchange routes, bridges, dependencies, correlations, capital flows, or communication channels.

In arbitrage, a graph allows searching for profitable cycles: USDT → ETH on a CEX, ETH → USDC on a DEX, USDC → USDT on another venue. In routing, it allows finding the path with the best net price after fees, slippage, and gas. In risk, it allows detecting concentration: too much exposure to the same asset, chain, stablecoin, exchange, bridge, or RPC provider. In agents, it allows modeling which component can invoke another and under what constraints.

The usefulness of the graph is that it turns an apparently chaotic problem into an exploitable mathematical structure. Arbitrage opportunities are paths; systemic risks are dependencies; constraints are weights; liquidity is capacity; latency is cost; and available capital is limited flow.

## 13. Dynamic trading as an adaptive systems problem

The operational objective of the system is not to execute a fixed strategy but to trade dynamically. This means the system must adapt to changes in volatility, liquidity, fees, funding, correlations, on-chain congestion, order book depth, macro events, regulatory changes, and participant behavior.

From a systems perspective, the market is a complex adaptive system. External agents react to prices, news, liquidations, funding incentives, token emissions, unlocks, hacks, governance, protocol changes, and liquidity migrations. Therefore, a strategy profitable in one regime can stop being so in another. The system must avoid the illusion of permanence: no statistical advantage is eternal.

For this reason, the project's context is not simply "create a bot," but build adaptation infrastructure. The system must measure when a strategy loses edge, when a venue becomes risky, when a route stops being viable, and when the best operation is not to trade.

## 14. Risk as the central architectural principle

In automated trading, risk is not a secondary module; it is the dominant property of the system. The main risks include market risk, liquidity risk, execution risk, counterparty risk, smart contract risk, bridge risk, API risk, latency risk, model risk, overfitting risk, custody risk, and regulatory risk.

IOSCO has identified critical areas for cryptoasset markets: conflicts of interest, market manipulation, fraud, cross-border risks, custody, protection of client assets, operational risk, technological risk, and retail access. These categories are directly relevant to a system interacting with CEXs and DEXs, because every automated operation touches at least one of those dimensions.

In DeFi, additional specific risks appear: MEV, contract vulnerabilities, liquidity concentration, oracle errors, governance attacks, and dependence on external infrastructure. DeFi reports have noted that MEV has become a structural dimension of the on-chain market, especially in high-activity, competitive execution environments.

## 15. Regulation and compliance as a design condition

The system must be understood within an increasingly strict regulatory environment. The European Union, through MiCA, advanced a formal framework for cryptoasset service providers, including authorizations, registrations, rules for stablecoins, conflicts of interest, and obligations applicable to CASPs. ESMA maintains information on registrations, authorizations, and non-conforming entities under the MiCA framework.

Although the system is technical, it cannot ignore compliance. Automation across CEXs, DEXs, and jurisdictions may imply KYC, AML, sanctions, geographic restrictions, tax treatment, derivatives rules, data protection, and each exchange's terms of service. Therefore, the project context must include from the start a separation between technical capability and legal permissibility: that an operation is technically possible does not mean it is permitted, safe, or sustainable.

_Note: this repository is a personal project without commercial KYC/AML. See ADR-0005. Regulatory knowledge is used only to understand structural risks._

## 16. The importance of observability, audit, and traceability

A multi-agent system that executes trades must be observable. This means every datum, decision, order, cancellation, error, fill, exception, and state change must be recorded. Without observability, one cannot distinguish between a bad strategy, bad execution, bad connectivity, bad liquidity, or unexpected agent behavior.

Traceability is also a form of defense. If an agent recommends an operation, the system must know which data it used, which constraints it evaluated, which model version was active, which prompt it received, which tools it invoked, and which risk limits applied. This turns the system into auditable infrastructure, not a black box.

In real trading, audit allows reconstructing incidents: why a position was opened, why it was not closed, why an order was duplicated, why a price with excessive slippage was accepted, or why a stop did not execute. Without this layer, the system can generate losses without reproducible explanation.

## 17. The need to separate signal, decision, and execution

A common error in trading bots is mixing signal with execution. In a robust architecture, detecting an opportunity is not the same as executing it. The signal must pass through validation layers: expected advantage, costs, slippage, liquidity, latency, exposure, correlation, venue risk, API state, available balances, position limits, and market conditions.

This separation is even more important in systems with AI Agents. An agent can be useful proposing hypotheses, classifying regimes, or interpreting context, but the final decision must be filtered by explicit rules. Execution must be deterministic, controlled, and reversible to the extent possible. In other words: agents can assist reasoning, but the risk system must govern action.

## 18. Capital, inventory, and liquidity as limited resources

The system must manage capital as a scarce resource distributed across venues. In arbitrage and market making, it is not enough to detect price differences: inventory must be available in the right place, at the right time, and in the right asset. Moving funds between CEXs, DEXs, and chains introduces costs, latency, and risk.

Therefore, the project context includes multi-venue inventory management. The system must know balances on exchanges, wallets, subaccounts, chains, stablecoins, and base tokens. It must also estimate how much capital is free, how much is committed in open orders, how much is exposed to market risk, and how much must be kept as a buffer for fees, gas, funding, or margin calls.

In cross-chain arbitrage, research shows that pre-positioned inventory is key because relying on real-time bridges introduces latencies that can destroy the opportunity.

## 19. Technical infrastructure as a competitive advantage

In algorithmic trading, the strategy does not live apart from infrastructure. Latency, reliability, data quality, error handling, state reconciliation, and recovery capability are part of the edge. A mathematically sound strategy can fail if the infrastructure executes late, reads inconsistent data, loses WebSocket events, or fails to detect a partial fill.

The infrastructure must contemplate per-exchange connectors, data normalization, an event engine, a message bus, historical storage, secret control, a permission system, order queues, simulators, monitors, alerts, and circuit breakers. It must also support distinct modes: backtest, paper trading, sandbox, limited production, and full production.

On CEXs, this implies robustness against rate limits, time sync, WebSocket disconnections, and order errors. On DEXs, it implies robustness against RPC failure, gas spikes, nonce conflicts, failed transactions, and MEV. Both layers require defensive engineering.

## 20. Justification of the repository as a research and production base

The repository exists as the technical core to consolidate this infrastructure. Its contextual purpose is to serve as the base for a system capable of operating in a fragmented, programmable, multi-venue, and highly competitive crypto market. It is not only about writing isolated strategies, but about building a platform where data, agents, graphs, loops, validators, connectors, and risk rules can interact in a controlled way.

The value of the project lies in integrating disciplines. From economics, it interprets liquidity, incentives, funding, demand, and market structure. From mathematics, it models probability, volatility, correlation, optimization, and statistical expectation. From physics, it understands momentum, friction, diffusion, price barriers, and regime transitions. From computer science, it implements distributed systems, APIs, agents, graphs, pipelines, and automation. From blockchain, it incorporates smart contracts, wallets, gas, bridges, MEV, and on-chain settlement.

This context positions the project as a multi-agent algorithmic trading infrastructure for hybrid crypto markets: CEX, DEX, CEX–CEX, DEX–DEX, CEX–DEX, and DEX–CEX. Its foundation is not manual speculation, but the construction of an adaptive system capable of observing markets, reasoning about opportunities, controlling risks, executing with precision, and learning from each operational cycle.

## 21. Context synthesis

The project is born from a market reality: crypto liquidity is fragmented, execution is programmable, opportunities are temporary, and risks are multidimensional. CEXs offer speed and depth; DEXs offer transparency and composability; bridges connect liquidity but add latency and risk; perpetuals add synthetic exposure and funding; agents add reasoning capability but require strict control; and orchestration turns isolated components into a coherent operating system.

Therefore, the essential context of the repository is the creation of an intelligent multi-agent trading infrastructure, designed to operate dynamically in centralized and decentralized markets, integrating APIs, smart contracts, AI Agents, orchestration, Harness Engineering, Loop Engineering, and Graph Engineering. The challenge is not only to find opportunities, but to build a system robust enough to evaluate, execute, or reject them under real market, risk, regulation, and infrastructure conditions.

## System Language

**Agent**:
A specialized module that produces typed observations, hypotheses, evaluations, or recommendations. It never executes orders, does not approve risk, and does not move funds.
_Avoid_: autonomous bot, entity with freedom of action, executing agent.

**AgentAdapter**:
A typed contract that isolates the deterministic core from LLM frameworks (Vercel AI SDK, Mastra). The StateGraph only consumes typed, validated outputs.
_Avoid_: core coupled to an LLM provider.

**StateGraph**:
The project's own minimal deterministic orchestrator that models the system as a state graph. Every transition has guard conditions, per-agent/module permissions, fallbacks, and mandatory audit.
_Avoid_: agent framework as the core (LangGraph, AutoGen).

**Loop**:
A closed perception → decision → action → learning cycle, with explicit frequency, inputs, outputs, permissions, and stopping criteria.
_Avoid_: reactive processing without frequency or stopping criteria.

**MarketGraph**:
Representation of the market as a directed, weighted graph. Nodes: assets, venues, chains, pools, accounts, strategies. Edges: order book, swap, bridge, transfer, funding, correlation. Weights: price, fee, gas, slippage, latency, liquidity, failure probability, risk.
_Avoid_: superficial price without net cost.

**OpportunityCandidate**:
An opportunity hypothesis with expected net profit (after fees, slippage, gas, bridges, funding, latency, and safety buffer), route, costs, and invalidation reasons.
_Avoid_: arbitrage signal without net costs.

**OrderIntent**:
A typed candidate order that only becomes a real order if the Risk Engine approves it. Includes idempotency key, limits, and expiry.
_Avoid_: direct order generated by an agent.

**Risk Engine**:
The deterministic authority that approves, rejects, reduces, or blocks every OrderIntent. Can trigger the kill switch. It is mandatory: no order exists without its approval.
_Avoid_: advisory risk agent, optional layer.

**Execution Engine**:
The only component that sends orders. It only accepts OrderIntents approved by the Risk Engine. Fails closed, never open.
_Avoid_: execution delegated to an agent or to LLM reasoning.

**Reconciliation**:
Comparison between the internal state and the real state of exchange, wallet, and chain. If it does not reconcile, the system does not open new positions and may activate defensive modes.
_Avoid_: trusting internal state without external verification.

**Harness**:
A reproducible environment for evaluating strategies and agents: backtest, replay, fill/slippage/gas/latency/failure simulators, and stress tests.
_Avoid_: promoting to production without reproducible evidence.

**Regime**:
A classification of market state (trend, range, high volatility, low liquidity, chop, gas spike, degraded venue, drawdown) that adjusts operational permissions. It can only reduce permissions; never increase them without deterministic validation.
_Avoid_: fixed limits ignoring market state.

**SystemMode**:
Global permission state enforced by the contracts package (`SYSTEM_MODES` in `packages/contracts/src/modes.ts`): `NORMAL`, `OBSERVE_ONLY`, `SIGNAL_ONLY`, `PAPER_ONLY`, `CANCEL_ONLY`, `REDUCE_ONLY`, `CASH_ONLY`, `HALT`. The system changes mode on failures or regime changes; modes can only reduce activity, never increase it. This matches ARCHITECTURE.md:39 and the RISK.md emergency chain. It diverges from the Spec Alpha mode list ("normal, degraded, signal-only, paper-only, cancel-only, reduce-only, cash-only, halt") by naming the first defensive mode `OBSERVE_ONLY` instead of `degraded`; the per-source data-quality state `DEGRADED` (DATA_QUALITY_STATES) covers the "degraded" concept. Renaming requires an ADR.
_Avoid_: trading always active.

**Phase**:
A roadmap milestone with an exit criterion defined by eliminated risk: Phase Zero (contracts and invariants), Alpha (data, graph, and harness), Beta (loops, orchestration, agents, risk, and paper trading), Gamma (live canary, adaptation, and hardening).
_Avoid_: advancing by feature count instead of by eliminated risk.
