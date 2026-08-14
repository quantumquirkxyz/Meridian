import {
  type DataQualityReport,
  type DataQualityState,
  isStateAtLeast,
  SYSTEM_MODES,
  type GuardResult,
  type StateContext,
  type SystemMode,
  type TransitionGuard,
} from "@agenttrading/contracts";

/**
 * Guard factories for the StateGraph (ARCHITECTURE.md:41). A guard decides
 * whether a transition is allowed in the current StateContext. Guards never
 * call LLMs and never depend on wall-clock randomness; they are pure functions
 * of the context, so the core stays deterministic (Phase Zero, user story 30).
 */

/** Guard that always allows the transition. */
export function alwaysAllow(name: string): TransitionGuard {
  return {
    name,
    evaluate(): GuardResult {
      return { ok: true, reason: "always allowed" };
    },
  };
}

/**
 * Guard built from a predicate; rejects with the given reason when false. The
 * success reason reflects the guard name (not the reject reason), so an
 * accepted transition never audits a contradictory explanation.
 */
export function allowWhen(
  name: string,
  predicate: (context: StateContext) => boolean,
  rejectReason: string,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (predicate(context)) {
        return { ok: true, reason: `${name} passed` };
      }
      return { ok: false, reason: rejectReason };
    },
  };
}

/**
 * Guard that passes only when every inner guard passes; short-circuits on the
 * first failure. Used to compose a single TransitionGuard from several checks
 * (e.g. a mode check plus a handoff-data check).
 */
export function allOf(
  name: string,
  guards: readonly TransitionGuard[],
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      for (const guard of guards) {
        const result = guard.evaluate(context);
        if (!result.ok) {
          return result;
        }
      }
      return { ok: true, reason: `all ${guards.length} guards passed` };
    },
  };
}

/**
 * Guard blocking the transition while the system is halted. Used on the
 * observation cycle start so a halted system cannot begin a new cycle;
 * activity inside a defensive mode is governed by the mode-based guards.
 */
export function notHalted(name: string): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (context.mode === "HALT") {
        return {
          ok: false,
          reason: "system is halted; new cycles cannot start",
        };
      }
      return { ok: true, reason: "system not halted" };
    },
  };
}

/**
 * Guard allowing the transition only when the current mode is one of the
 * given modes. Encodes the "defensive modes reduce activity" rule: states that
 * build or execute orders only run in modes that permit that activity.
 */
export function modeAllows(
  name: string,
  allowedModes: readonly SystemMode[],
): TransitionGuard {
  const allowed = new Set<SystemMode>(allowedModes);
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (allowed.has(context.mode)) {
        return { ok: true, reason: `mode ${context.mode} allowed` };
      }
      return {
        ok: false,
        reason: `mode ${context.mode} does not allow this activity`,
      };
    },
  };
}

/**
 * Guard requiring that a key exists in `context.data`. Used to enforce that a
 * transition only advances once the previous stage produced its typed payload
 * (e.g. EXECUTION_PRECHECK requires a risk decision).
 */
export function requiresData(
  name: string,
  key: string,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      if (context.data !== undefined && context.data[key] !== undefined) {
        return { ok: true, reason: `${key} present` };
      }
      return { ok: false, reason: `missing ${key}` };
    },
  };
}

/**
 * Guard requiring `context.data[key]` to equal a given value. Used to gate
 * data-dependent forks, e.g. RISK_VALIDATE -> EXECUTION_PRECHECK only when the
 * stored risk decision outcome is APPROVE.
 */
export function dataEquals(
  name: string,
  key: string,
  expected: unknown,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const value = context.data?.[key];
      if (value === expected) {
        return { ok: true, reason: `${key} equals ${String(expected)}` };
      }
      return {
        ok: false,
        reason: `${key} is not ${String(expected)}`,
      };
    },
  };
}

/**
 * Mode restrictiveness ordering for defensive-mode entry (RISK.md:63-67,
 * fail closed). SYSTEM_MODES is already ordered least -> most restrictive:
 * NORMAL is the least restrictive and HALT the most. A transition into a
 * defensive mode is allowed only when the target mode is at least as
 * restrictive as the current mode, so activity never increases.
 */
export const MODE_ORDER: readonly SystemMode[] = SYSTEM_MODES;

const MODE_RANK = new Map<SystemMode, number>(
  MODE_ORDER.map((mode, index) => [mode, index]),
);

/**
 * Guard for entering a defensive mode. Rejects the transition when the target
 * mode would be less restrictive than the current mode (e.g. leaving HALT for
 * CASH_ONLY), enforcing "modes can only reduce activity" (modes.ts, RISK.md).
 */
export function defensiveEntry(
  name: string,
  targetMode: SystemMode,
): TransitionGuard {
  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const currentRank = MODE_RANK.get(context.mode) ?? 0;
      const targetRank = MODE_RANK.get(targetMode) ?? 0;
      if (targetRank >= currentRank) {
        return {
          ok: true,
          reason: `${targetMode} is at least as restrictive as ${context.mode}`,
        };
      }
      return {
        ok: false,
        reason: `${targetMode} would increase activity from ${context.mode}`,
      };
    },
  };
}

/**
 * Guard that blocks signal generation when the data sources feeding the
 * current opportunity are degraded or worse. Reads `dataQualityReports` from
 * the transition context (an array of DataQualityReport) and checks whether
 * any source referenced by `sourceKeys` in `context.data` is at least as
 * restrictive as the given threshold (default STALE).
 *
 * Acceptance criteria (issue #18 AC2):
 * - Degraded sources block dependent signal generation when threshold is
 *   DEGRADED or stricter.
 * - STALE sources block dependent signal generation when threshold is STALE
 *   (default).
 */
export function dataQualityBlocksSignal(
  name: string,
  options: {
    /** Keys in context.data to check for source reports (default: ["source"]). */
    sourceKeys?: string[];
    /** Minimum state that blocks signal generation (default: "STALE"). */
    threshold?: DataQualityState;
  } = {},
): TransitionGuard {
  const sourceKeys = options.sourceKeys ?? ["source"];
  const threshold = options.threshold ?? "STALE";

  return {
    name,
    evaluate(context: StateContext): GuardResult {
      const reports = (context.data?.dataQualityReports ??
        []) as DataQualityReport[];
      if (reports.length === 0) {
        return { ok: true, reason: "no data quality reports; proceeding" };
      }

      for (const key of sourceKeys) {
        const sourceId = context.data?.[key];
        if (typeof sourceId !== "string") continue;

        const report = reports.find((r) => r.source === sourceId);
        if (report && isStateAtLeast(report.state, threshold)) {
          return {
            ok: false,
            reason: `source ${sourceId} quality ${report.state} blocks signal generation (threshold: ${threshold})`,
          };
        }
      }

      // Also check all reports: if any source in the report list is at least
      // as restrictive as the threshold, block. This catches cases where
      // multiple sources feed the opportunity.
      for (const report of reports) {
        if (isStateAtLeast(report.state, threshold)) {
          return {
            ok: false,
            reason: `source ${report.source} quality ${report.state} blocks signal generation (threshold: ${threshold})`,
          };
        }
      }

      return { ok: true, reason: "all data sources quality sufficient" };
    },
  };
}

/**
 * Guard that marks graph edges from degraded sources as non-tradable. This
 * is not a transition guard but a pure function that returns the edges with
 * updated `tradable` flags based on data quality reports.
 *
 * Acceptance criteria (issue #18 AC3):
 * - Graph edges from degraded sources become non-tradable.
 */
export function markEdgesFromDegradedSources<
  E extends { source: string; tradable: boolean },
>(
  edges: readonly E[],
  reports: readonly DataQualityReport[],
  threshold: DataQualityState = "DEGRADED",
): E[] {
  return edges.map((edge) => {
    const report = reports.find((r) => r.source === edge.source);
    if (report && isStateAtLeast(report.state, threshold)) {
      return { ...edge, tradable: false };
    }
    return edge;
  });
}
