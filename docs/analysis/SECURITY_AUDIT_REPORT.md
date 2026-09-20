# Security Audit Report — Meridian AgentTrading System

**Date:** 2026-09-12  
**Auditor:** Kilo (sec-security-audit skill)  
**Scope:** Full source code audit of `/home/quantumquirkxyz/Meridian` (all packages in monorepo)  
**Methodology:** Manual code review, threat modeling, secret scanning, dependency analysis, cryptographic review

---

## 1. Scope

### In Scope
- All source code in `packages/`:
  - `@agenttrading/cli` — CLI entry point, config loader, live runner
  - `@agenttrading/connectors` — Bybit (REST/WS), Binance, PancakeSwap v4 market data
  - `@agenttrading/chain` — DEX executor (viem, on-chain swap execution)
  - `@agenttrading/core` — Risk engine, execution, reconciliation, state graph, inventory
  - `@agenttrading/agents` — Agent runtime, adapters, catalog, LLM integration (OpenRouter)
  - `@agenttrading/contracts` — Shared types, schemas, validators, reason codes
  - `@agenttrading/graph` — MarketGraph, pathfinding, cycle detection
  - `@agenttrading/infra` — Observability, data quality, TUI (Ink/React)
  - `@agenttrading/events` — Event bus, SQLite persistence, replay
  - `@agenttrading/harness` — Backtest, simulators, stress tests
- Configuration: `.env`, `.env.example`, `canary-live.json`
- Dependency lockfile: `pnpm-lock.yaml`

### Out of Scope
- Third-party SaaS (Bybit, Binance, OpenRouter, PancakeSwap RPC providers)
- Physical security, network infrastructure, OS hardening
- CI/CD pipeline security (no CI config found)
- Runtime container/host security

---

## 2. Threat Model (Rapid)

| Asset | Threats | Mitigations Present | Gaps |
|-------|---------|---------------------|------|
| **API Keys (Bybit, Binance, OpenRouter)** | Theft via log leakage, memory dump, `.env` exposure | `.env` in `.gitignore`; keys passed via env vars only | Keys in `.env` file on disk (plaintext); audit logs may capture sensitive fields |
| **DEX Private Key** | Theft → unauthorized on-chain transactions | Only used in `DEXExecutor`; optional (market-data-only mode) | Private key in memory as plaintext; no HSM/secure enclave |
| **Trading Capital** | Unauthorized orders, fund drainage | Risk Engine (18 rules), kill switch, reconciliation, canary limits | No multi-sig; single key controls execution |
| **Market Data Integrity** | Poisoned feeds → bad decisions | Data quality monitor, reconciliation, multi-venue cross-check | No cryptographic verification of WS/REST responses |
| **Audit Trail** | Tampering, loss | JSONL append-only, session IDs, deterministic replay | No integrity protection (Merkle tree, signing) |
| **System Availability** | DoS via WS flood, RPC exhaustion | Rate limiting, backoff, circuit breakers (planned) | No WAF, no DDoS protection at network layer |

---

## 3. Findings

### CRITICAL

| ID | Finding | File/Line | Evidence | Recommendation |
|----|---------|-----------|----------|----------------|
| **SEC-001** | **Real API keys committed to `.env` file** | `.env:13-14,18` | `BYBIT_API_KEY=lANmyTcDvVCUDumbCU`<br>`BYBIT_API_SECRET=sVLKbEbmkSVjauVLK65puoF5V4WJAit7xxNJ`<br>`LLM_API_KEY=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` | **Immediately rotate all three keys.** Remove `.env` from working directory. Use a secret manager (1Password, Bitwarden, HashiCorp Vault) or inject via CI/CD at runtime. Never store production keys in repo-adjacent files. |
| **SEC-002** | **DEX private key in memory as plaintext** | `packages/chain/src/dex-executor.ts:126,147` | `this.privateKey = config.privateKey`<br>`account: this.privateKey` (passed to `createWalletClient`) | For production: use a hardware wallet (Ledger, Trezor) via `viem`'s `Ledger` transport, or a KMS (AWS KMS, GCP KMS) for signing. At minimum, zeroize memory after use (not possible in JS/TS easily — consider a dedicated signer process). |

### HIGH

| ID | Finding | File/Line | Evidence | Recommendation |
|----|---------|-----------|----------|----------------|
| **SEC-003** | **No input validation on WebSocket messages** | `packages/connectors/src/bybit-ws.ts:297-339` | `JSON.parse(raw)` without schema validation; `parsed.auth`, `parsed.success`, `parsed.topic`, `parsed.data` accessed directly | Add strict schema validation using `@agenttrading/contracts` validators (`isObjectOf`, `isEnumOf`) before processing any WS message. Reject malformed messages early. |
| **SEC-004** | **Audit logs may leak sensitive data** | `packages/core/src/execution/audit-logger.ts:73-83` | `record(type, data)` writes arbitrary `data` to JSONL; `LiveRunner` calls `auditLogger.record("WS_ORDER_UPDATE", {...})` with order details | Implement a **PII/sensitive-field allowlist/denylist** in `AuditLogger.record()`. Strip `apiKey`, `apiSecret`, `privateKey`, `signature`, `walletBalance` before writing. |
| **SEC-005** | **HMAC signing uses `sha256` but no constant-time comparison** | `packages/connectors/src/bybit-rest.ts:318`<br>`packages/connectors/src/bybit-ws.ts:276` | `createHmac("sha256", secret).update(payload).digest("hex")` — verification is done by Bybit, not locally | Not directly exploitable (verification is server-side), but document why timing attacks aren't a concern here. If local HMAC verification is added later, use `crypto.timingSafeEqual`. |
| **SEC-006** | **RPC calls to PancakeSwap lack authentication/integrity** | `packages/connectors/src/pancakeswap-v4.ts:79-98` | `evmCall()` uses plain `fetch` to RPC URL; no auth, no response verification | Use authenticated RPC endpoints (e.g., QuickNode, Alchemy with JWT). Verify responses against known-good block hashes or use multiple RPC providers for consensus. |
| **SEC-007** | **No TLS certificate pinning for exchange connections** | `packages/connectors/src/bybit-rest.ts:322`<br>`packages/connectors/src/bybit-ws.ts:86` | `fetch(url, init)` and `new WebSocket(url)` use system CA trust store only | For production: implement certificate pinning (HPKP or custom CA) for Bybit/Binance REST and WS endpoints. |

### MEDIUM

| ID | Finding | File/Line | Evidence | Recommendation |
|----|---------|-----------|----------|----------------|
| **SEC-008** | **LLM API key passed through multiple layers** | `packages/cli/src/live-runner.ts:335-337,735-749` | `llmApiKey` stored in `LiveRunner.config` → passed to `createOpenAI()` → `VercelAISDKAdapter` | Minimize scope: inject LLM client at adapter creation only; don't store key in long-lived `LiveRunner` config. Consider short-lived API tokens. |
| **SEC-009** | **No rate limiting on private WebSocket authentication** | `packages/connectors/src/bybit-ws.ts:269-285` | `authenticatePrivateStream()` sends auth on every reconnect; no backoff on auth failure | Add auth-retry backoff and max attempts. Lock out after N failures to prevent credential stuffing. |
| **SEC-010** | **SQLite event store uses parameterized queries (GOOD)** | `packages/events/src/store.ts:74-78` | Uses `?` placeholders: `INSERT OR IGNORE INTO events (event_id, sequence, ...) VALUES (?, ?, ?, ?, ?, ?, ?)` | **No action needed** — this is a positive finding. Parameterized queries prevent SQL injection. |
| **SEC-011** | **Binance connector has HMAC signing but no testnet/mainnet separation enforcement** | `packages/connectors/src/binance-rest.ts:11-15` | `BinanceConnectorConfig` accepts `baseUrl` but no validation | Add explicit `testnet: boolean` config; default to testnet; require explicit opt-in for mainnet. |
| **SEC-012** | **No secrets scanning in CI/CD** | N/A | No CI config found (`.github/`, `.gitlab/`, `Jenkinsfile`, etc.) | Add `trufflehog`, `gitleaks`, or `git-secrets` to pre-commit and CI pipeline. |

### LOW

| ID | Finding | File/Line | Evidence | Recommendation |
|----|---------|-----------|----------|----------------|
| **SEC-013** | **`Math.random()` used for session ID generation** | `packages/core/src/execution/audit-logger.ts:103` | `Math.random().toString(16).slice(2, 8)` | Use `crypto.randomUUID()` or `crypto.getRandomValues()` for cryptographically secure randomness. |
| **SEC-014** | **Error messages may leak internal state** | `packages/connectors/src/bybit-rest.ts:354-358` | `throw new BybitAPIError(\`Bybit API error ${body.retCode}: ${body.retMsg}\`)` | Sanitize error messages in production; log full details internally but return generic messages to callers. |
| **SEC-015** | **No dependency integrity verification (subresource integrity)** | `pnpm-lock.yaml` | Lockfile present but no `npm audit`/`bun audit` in CI | Add `bun audit` to CI pipeline; fail on `moderate`+. Consider `pnpm audit --prod`. |
| **SEC-016** | **WebSocket reconnection uses exponential backoff but no jitter** | `packages/connectors/src/bybit-ws.ts:496-508` | `INITIAL_BACKOFF_MS * Math.pow(2, attempt)` — deterministic | Add jitter: `backoffMs * (0.5 + Math.random())` to prevent thundering herd. |

### INFORMATIONAL

| ID | Finding | File/Line | Evidence | Recommendation |
|----|---------|-----------|----------|----------------|
| **SEC-017** | **Excellent: Contracts package is dependency-free** | `packages/contracts/package.json:16` | `"dependencies": {}` | **Positive** — reduces supply chain attack surface. |
| **SEC-018** | **Good: Risk Engine fails closed on missing loss state** | `packages/core/src/risk/risk-gate.ts:462-468` | `if (input.dailyLossUsd === undefined) { decision = "REJECT"; reasonCodes.push("LOSS_STATE_MISSING") }` | **Positive** — fail-closed design. |
| **SEC-019** | **Good: Reconciliation blocks trading on mismatch** | `packages/cli/src/live-runner.ts:1250,1270` | `session.setReconciliationStatus(report.unresolved)` → RiskEngine rejects | **Positive** — defense in depth. |
| **SEC-020** | **Good: Private keys never logged (by design)** | `packages/cli/src/config.ts:135-136` | Keys read from `Bun.env`; not logged in `loadConfig()` | **Positive** — but ensure no accidental logging in error paths. |

---

## 4. Dependency Vulnerability Scan

**Tool:** `bun audit v1.4.0` (69 packages checked)  
**Result:** **No vulnerabilities found**

| Package | Version | Status |
|---------|---------|--------|
| `viem` | ^2.56.3 | ✅ Clean |
| `ink` | ^7.1.1 | ✅ Clean |
| `react` | ^19.2.8 | ✅ Clean |
| `@ai-sdk/openai` | ^4.0.56 | ✅ Clean |
| `ai` | ^7.0.90 | ✅ Clean |
| `typescript` | 5.9.3 | ✅ Clean |
| `@types/bun` | 1.4.0 | ✅ Clean |

> **Note:** `bun audit` checks the resolved lockfile. Re-run before each release. Consider adding `bun audit` to CI.

---

## 5. Remediation Priority Checklist

| Priority | Finding | Effort | Impact | Owner |
|----------|---------|--------|--------|-------|
| **P0** | SEC-001: Rotate exposed API keys | 15 min | Critical | You |
| **P0** | SEC-002: Secure DEX private key (HSM/KMS) | 2-4 hrs | Critical | You |
| **P1** | SEC-003: Add WS message schema validation | 2 hrs | High | Dev |
| **P1** | SEC-004: Sanitize audit logs | 1 hr | High | Dev |
| **P1** | SEC-006: Authenticated RPC endpoints | 30 min | High | Dev |
| **P1** | SEC-007: TLS cert pinning | 2 hrs | High | Dev |
| **P2** | SEC-008: Minimize LLM key scope | 1 hr | Medium | Dev |
| **P2** | SEC-009: WS auth rate limiting | 1 hr | Medium | Dev |
| **P2** | SEC-011: Binance testnet/mainnet config | 30 min | Medium | Dev |
| **P2** | SEC-012: Add secrets scanning to CI | 1 hr | Medium | DevOps |
| **P3** | SEC-013: Use crypto RNG for session IDs | 15 min | Low | Dev |
| **P3** | SEC-014: Sanitize error messages | 30 min | Low | Dev |
| **P3** | SEC-015: Add `bun audit` to CI | 15 min | Low | DevOps |
| **P3** | SEC-016: Add jitter to WS reconnect | 15 min | Low | Dev |

---

## 6. Limitations

- **No dynamic analysis** — only static code review performed.
- **No penetration testing** — no live endpoints tested.
- **No dependency deep-scan** — `bun audit` only checks known CVEs in registry; doesn't detect malicious code in dependencies.
- **No infrastructure review** — DNS, TLS, firewall, VPC not assessed.
- **No social engineering / phishing assessment** — out of scope.

---

## 7. Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| High | 5 |
| Medium | 5 |
| Low | 4 |
| Informational | 4 |

**Overall Risk Rating: HIGH** — due to **SEC-001** (live keys in `.env`) and **SEC-002** (DEX private key in memory). These must be remediated before any live trading with real capital.

**Positive Notes:** The codebase demonstrates strong security hygiene in several areas: dependency-free contracts, fail-closed risk engine, parameterized SQL, reconciliation-based defense, and no dynamic code execution (`eval`, `Function` constructor). The architecture's strict boundaries (ADR-0001, ADR-0011) limit blast radius.