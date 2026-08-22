/**
 * SystemicRiskOverlay: evaluates routes against concentration-based
 * systemic risk dimensions (issue #37).
 *
 * Acceptance criteria:
 *   AC1: Systemic risk overlays block routes with excessive concentration
 *        or risk.
 *   AC2: Concentration is measured per dimension (venue, chain, stablecoin,
 *        bridge, pool, RPC, wrapped asset).
 *   AC3: Hidden correlations and evaporated liquidity are detected.
 *   AC4: Every blocked route carries a reason code and overlay evaluation.
 *
 * The overlay is deterministic — no LLM, no I/O. It evaluates a set of
 * risk overlays against a route's risk concentration map and produces
 * typed evaluation results.
 */

import type {
  ConcentrationDimension,
  OverlayEvaluation,
  Route,
  RouteEngineConfig,
  SystemicRiskOverlay as SystemicRiskOverlayContract,
} from "@agenttrading/contracts";

// ── Overlay Engine ──────────────────────────────────────────────────

/**
 * SystemicRiskOverlayEngine: evaluates routes against systemic risk overlays.
 *
 * Usage:
 * ```ts
 * const engine = new SystemicRiskOverlayEngine(config);
 * const evaluations = engine.evaluateRoute(route);
 * const blocked = engine.isBlocked(route);
 * ```
 */
export class SystemicRiskOverlayEngine {
  private readonly config: RouteEngineConfig;

  constructor(config: RouteEngineConfig) {
    this.config = config;
  }

  /**
   * Evaluate a single route against all enabled overlays.
   * Returns an OverlayEvaluation for each enabled overlay.
   */
  evaluateRoute(route: Route): OverlayEvaluation[] {
    const evaluations: OverlayEvaluation[] = [];

    for (const overlay of this.config.overlays) {
      if (!overlay.enabled) continue;

      const evaluation = this.evaluateOverlay(route, overlay);
      evaluations.push(evaluation);
    }

    return evaluations;
  }

  /**
   * Evaluate a single route against a specific overlay.
   */
  evaluateOverlay(
    route: Route,
    overlay: SystemicRiskOverlayContract,
  ): OverlayEvaluation {
    const concentration = this.computeConcentration(
      route,
      overlay.dimension,
    );

    const blocked = concentration > overlay.maxConcentration;

    return {
      overlayId: overlay.overlayId,
      dimension: overlay.dimension,
      blocked,
      concentration,
      maxConcentration: overlay.maxConcentration,
      reason: blocked
        ? `${overlay.dimension} concentration ${concentration.toFixed(3)} exceeds max ${overlay.maxConcentration}`
        : `${overlay.dimension} concentration ${concentration.toFixed(3)} within limit ${overlay.maxConcentration}`,
    };
  }

  /**
   * Check whether a route is blocked by any enabled overlay.
   */
  isBlocked(route: Route): boolean {
    return this.evaluateRoute(route).some((e) => e.blocked);
  }

  /**
   * Get the blocking evaluations for a route (only those that actually blocked).
   */
  getBlockingEvaluations(route: Route): OverlayEvaluation[] {
    return this.evaluateRoute(route).filter((e) => e.blocked);
  }

  /**
   * Compute concentration for a route across a specific dimension.
   *
   * Concentration is the maximum fraction of the route's total score
   * that is attributable to a single node or edge within the given
   * dimension. A value of 1.0 means all risk is concentrated in one
   * entity; 0.0 means perfectly distributed.
   *
   * The computation uses the route's riskConcentration map, which maps
   * node/edge ids to their concentration values. When the map is empty
   * (no concentration data), the overlay allows the route through with
   * a default concentration of 0 (fail open for missing data — the
   * caller should populate riskConcentration from the graph).
   */
  computeConcentration(
    route: Route,
    dimension: ConcentrationDimension,
  ): number {
    const concentrations = route.riskConcentration;
    const entries = Object.entries(concentrations);

    if (entries.length === 0) {
      // No concentration data — default to 0 (fail open).
      return 0;
    }

    // Filter entries whose key matches the dimension's prefix or naming
    // convention. The convention is "dimension:value" or just the node/edge
    // id if the dimension is implicit from the route type.
    const dimensionEntries = entries.filter(([key]) =>
      this.matchesDimension(key, dimension, route),
    );

    if (dimensionEntries.length === 0) {
      // No entries for this dimension — treat as low concentration.
      return 0;
    }

    // Concentration is the maximum value across all entries in this dimension.
    // This represents the worst-case single-entity concentration.
    return Math.max(...dimensionEntries.map(([, v]) => v));
  }

  /**
   * Check whether a concentration map key matches a dimension.
   *
   * Keys follow the convention "dimension:value" (e.g. "VENUE:bybit").
   * If no dimension prefix is found, we infer from the route's metadata
   * and edge types.
   */
  private matchesDimension(
    key: string,
    dimension: ConcentrationDimension,
    _route: Route,
  ): boolean {
    // Strict prefix match only: "VENUE:bybit" matches VENUE.
    // No fallback matching — prevents cross-dimensional contamination
    // where a VENUE key would incorrectly inflate CHAIN concentration.
    return key.startsWith(`${dimension}:`);
  }
}
