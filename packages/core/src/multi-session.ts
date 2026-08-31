/** MultiSessionOrchestrator: agent per venue/pair
 * Implements CONTEXT-7 (multi-agent) + CONTEXT-4 (multi-venue).
 * Each (venue, symbol) gets its own GammaSession config.
 */
import { GammaSession, type GammaCycleInput } from "./gamma/gamma-session.ts";
import type { CanaryConfig } from "@agenttrading/contracts";

export interface SessionKey { venue: string; symbol: string; }

export class MultiSessionOrchestrator {
  private sessions = new Map<string, GammaSession>();

  getOrCreate(key: SessionKey, canaryConfig: CanaryConfig): GammaSession {
    const k = `${key.venue}::${key.symbol}`;
    if (!this.sessions.has(k)) {
      const s = new GammaSession({ canaryConfig: { ...canaryConfig, scope: { ...canaryConfig.scope, allowedVenues: [key.venue], allowedTokens: [key.symbol] } } });
      s.start();
      this.sessions.set(k, s);
    }
    return this.sessions.get(k)!;
  }

  runCycle(key: SessionKey, input: GammaCycleInput, canaryConfig: CanaryConfig) {
    return this.getOrCreate(key, canaryConfig).runCycle(input);
  }

  stopAll(): void {
    this.sessions.forEach((s) => s.stop());
    this.sessions.clear();
  }

  status(): Record<string, unknown> {
    const r: Record<string, unknown> = {};
    this.sessions.forEach((s, k) => r[k] = s.status);
    return r;
  }
}
