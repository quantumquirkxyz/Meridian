=== PLAN DE CORRECCIÓN PARA LIVE TRADING ===
ARCHIVO / ESTADO / CORRECCIÓN DETALLADA

1. .env / CLI (packages/cli/src/index.ts)
   - Estado: MODE=demo, claves demo validas. Endpoint demo correcto (api-demo.bybit.com).
   - Corrección: NO cambiar a live hasta confirmar withdrawalsDisabled en clave real, clave separada de demo, y límite de capital < $1000 (actual DEFAULT_CANARY_CONFIG). Usar --config canary-live.json con maxCapitalUsd=500, maxRiskPerTradeUsd=25.

2. packages/contracts/src/canary-config.ts (DEFAULT_CANARY_CONFIG)
   - Estado: Validado con parseCanaryConfig.
   - Corrección: Definir canary-live.json con capitalLimits estrictos, scope permitidos (BTCUSDT, ETHUSDT), apiKeys.withdrawalsDisabled=true, killSwitch.autoHaltDailyLossUsd=50.

3. packages/connectors/src/bybit-rest.ts
   - Estado: DEMO_BASE_URL = api-demo.bybit.com; LIVE = api.bybit.com. OK.
   - Corrección: Para live, asegurar que .env no mezcle endpoints. El CLI ya hace switch automático por mode.

4. packages/cli/src/live-runner.ts
   - Estado: Auth privada OK (demo), reconciliación, ciclo 5s.
   - Corrección: Antes de live, validar que onShutdown escriba audit.jsonl y manifest.json; comprobar que no haya orders huérfanos sin reconciliar.

5. packages/core/src/live/ (TradingSession / CanarySession)
   - Estado: Sesión operativa via session.start/stop.
   - Corrección: Verificar que killSwitchActive se active al drawdown; que openOrders esté limitado por maxOpenOrders del canary.

6. REQUISITOS HUMANOS PRE-LIVE (no automáticos)
   a) Confirmar clave REAL con withdrawalsDisabled.
   b) Crear canary-live.json (ejemplo en /tmp/).
   c) Probar primero con --dry-run + --mode live + --config canary-live.json.
   d) No usar clave demo en .env para live (ya se restauraron demo keys).
