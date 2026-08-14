import { type SystemMode } from "@agenttrading/contracts";

/**
 * Mode vocabularies shared across the core (ARCHITECTURE.md, RISK.md). A single
 * source of truth for which activity each SystemMode permits, so the RiskGate,
 * StateGraph topology, and flow guards cannot drift apart.
 */

/** Modes in which signal-generation states may run (no execution). */
export const SIGNAL_MODES: readonly SystemMode[] = [
  "NORMAL",
  "SIGNAL_ONLY",
  "PAPER_ONLY",
];

/** Modes in which execution states may run (paper execution only in Alpha). */
export const EXECUTION_MODES: readonly SystemMode[] = ["NORMAL", "PAPER_ONLY"];
