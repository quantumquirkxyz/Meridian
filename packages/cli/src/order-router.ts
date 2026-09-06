/**
 * BybitDexOrderRouter: the production OrderRouter (ADR-0011).
 *
 * Routes an OrderIntent to the appropriate venue connector:
 * - "pancakeswap-v4" (DEX) → on-chain swap via DEXExecutor
 * - any other venue (CEX) → REST placeOrder via BybitRESTClient
 *
 * The router carries no canary enforcement and no risk authority — those
 * remain with the LiveExecutionEngine and the Risk Engine respectively.
 */

import {
  isDexIntent,
  type OrderIntent,
  type OrderRouteAck,
  type OrderRouter,
  type RiskDecision,
} from "@agenttrading/contracts";
import { BybitRESTClient } from "@agenttrading/connectors";
import { DEXExecutor } from "@agenttrading/chain";

export interface BybitDexOrderRouterOptions {
  /** Bybit REST client used for CEX order placement. */
  restClient: BybitRESTClient;
  /** Optional DEX executor used for on-chain swaps. */
  dexExecutor?: DEXExecutor;
  /** Bybit order category (default: "linear"). */
  orderCategory?: "spot" | "linear" | "inverse" | "option";
}

export class BybitDexOrderRouter implements OrderRouter {
  private readonly restClient: BybitRESTClient;
  private readonly dexExecutor?: DEXExecutor;
  private readonly orderCategory: "spot" | "linear" | "inverse" | "option";

  constructor(options: BybitDexOrderRouterOptions) {
    this.restClient = options.restClient;
    this.dexExecutor = options.dexExecutor;
    this.orderCategory = options.orderCategory ?? "linear";
  }

  async route(intent: OrderIntent, riskDecision: RiskDecision): Promise<OrderRouteAck> {
    // Fail closed (ADR-0003): never send an order the Risk Engine did not approve.
    if (riskDecision.decision !== "APPROVE") {
      throw new Error(
        `router requires an APPROVE risk decision, got ${riskDecision.decision} for ${intent.idempotencyKey}`,
      );
    }
    if (isDexIntent(intent)) {
      return this.routeDex(intent);
    }
    return this.routeCex(intent);
  }

  /** Place a limit order on Bybit for a CEX-routed intent. */
  private async routeCex(intent: OrderIntent): Promise<OrderRouteAck> {
    const result = await this.restClient.placeOrder({
      category: this.orderCategory,
      symbol: intent.symbol,
      side: intent.side === "BUY" ? "Buy" : "Sell",
      orderType: "Limit",
      qty: String(intent.quantity),
      price: String(intent.price),
      orderLinkId: intent.idempotencyKey,
    });

    return {
      orderId: result.orderId,
      venue: intent.venue,
    };
  }

  /** Execute an on-chain swap on PancakeSwap for a DEX-routed intent. */
  private async routeDex(intent: OrderIntent): Promise<OrderRouteAck> {
    if (!this.dexExecutor) {
      throw new Error(
        `DEX venue ${intent.venue} is not configured (no private key)`,
      );
    }

    // Token amounts are derived from the intent quantity in the base asset;
    // route through a quoted path (pool reverse of intent). Amount in wei:
    // assume the quote asset has 18 decimals.
    const notionalUsd = intent.quantity * intent.price;
    const amountIn = BigInt(Math.trunc(notionalUsd * 1e18));
    // Preserve a gas estimation call so non-contract gas estimation still
    // surfaces connector errors before the swap is attempted.
    await this.dexExecutor.getGasInfo();
    const amountOutMin = amountIn / BigInt(100); // 1% minimum slippage floor
    const path: readonly `0x${string}`[] = [
      intent.symbol.toLowerCase() as `0x${string}`,
      intent.quoteCurrency.toLowerCase() as `0x${string}`,
    ];

    const result = await this.dexExecutor.executeSwap({
      path,
      amountIn,
      amountOutMin,
      to: this.dexExecutor.account,
      deadlineMs: intent.expiresAtMs,
    });

    return {
      orderId: result.txHash,
      venue: intent.venue,
      externalRef: result.txHash,
    };
  }
}