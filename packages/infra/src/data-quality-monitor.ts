import {
  type DataQualityMetrics,
  type DataQualityReport,
  type DataQualityState,
  DEFAULT_SCORING_THRESHOLDS,
  evaluateDataQuality,
  isStateAtLeast,
  STATE_RULES,
  type DataQualityScoringThresholds,
} from "@agenttrading/contracts";

/**
 * Callback invoked when a source transitions to DISCONNECTED. The caller
 * should attempt reconnection.
 */
export type ReconnectCallback = (source: string) => void;

/**
 * Callback invoked when a source transitions to DISCONNECTED (alert).
 */
export type AlertCallback = (source: string, report: DataQualityReport) => void;

/**
 * Callback invoked on any state transition.
 */
export type StateChangeCallback = (
  source: string,
  previousState: DataQualityState | null,
  currentReport: DataQualityReport,
) => void;

/**
 * Per-source tracking state maintained by the monitor.
 */
export interface SourceTracking {
  report: DataQualityReport;
  /** History of the last N scores for trend analysis. */
  scoreHistory: number[];
}

const MAX_SCORE_HISTORY = 20;

/**
 * DataQualityMonitor: per-source quality tracking, scoring, state machine,
 * alert publishing, and reconnection triggering (issue #18).
 *
 * The monitor is a pure state container — it evaluates incoming metrics,
 * derives reports, tracks state transitions, and notifies listeners. It does
 * not own the event bus; callers publish DATA_QUALITY_UPDATE events from the
 * returned reports.
 */
export class DataQualityMonitor {
  private readonly sources = new Map<string, SourceTracking>();
  private readonly thresholds: DataQualityScoringThresholds;
  private readonly reconnectCallbacks: ReconnectCallback[] = [];
  private readonly alertCallbacks: AlertCallback[] = [];
  private readonly stateChangeCallbacks: StateChangeCallback[] = [];

  constructor(
    thresholds: DataQualityScoringThresholds = DEFAULT_SCORING_THRESHOLDS,
  ) {
    this.thresholds = thresholds;
  }

  /** Register a callback for DISCONNECTED events (reconnection trigger). */
  onReconnect(callback: ReconnectCallback): void {
    this.reconnectCallbacks.push(callback);
  }

  /** Register a callback for DISCONNECTED events (alert). */
  onAlert(callback: AlertCallback): void {
    this.alertCallbacks.push(callback);
  }

  /** Register a callback for any state transition. */
  onStateChange(callback: StateChangeCallback): void {
    this.stateChangeCallbacks.push(callback);
  }

  /**
   * Evaluate incoming metrics and return the updated DataQualityReport. If
   * the source's state changed, callbacks are invoked synchronously.
   */
  evaluate(metrics: DataQualityMetrics, nowMs: number): DataQualityReport {
    const previous = this.sources.get(metrics.source);
    const previousState = previous?.report.state ?? null;

    const report = evaluateDataQuality(metrics, nowMs, this.thresholds);

    const history = previous?.scoreHistory ?? [];
    const newHistory = [...history, report.score].slice(-MAX_SCORE_HISTORY);

    this.sources.set(metrics.source, {
      report,
      scoreHistory: newHistory,
    });

    if (previousState !== report.state) {
      for (const cb of this.stateChangeCallbacks) {
        cb(metrics.source, previousState, report);
      }
    }

    if (report.state === "DISCONNECTED" && previousState !== "DISCONNECTED") {
      for (const cb of this.reconnectCallbacks) {
        cb(metrics.source);
      }
      for (const cb of this.alertCallbacks) {
        cb(metrics.source, report);
      }
    }

    return report;
  }

  /** Get the latest report for a source, or undefined if never seen. */
  getReport(source: string): DataQualityReport | undefined {
    return this.sources.get(source)?.report;
  }

  /** Get the score history for a source. */
  getScoreHistory(source: string): readonly number[] {
    return this.sources.get(source)?.scoreHistory ?? [];
  }

  /** Get all current reports. */
  getAllReports(): DataQualityReport[] {
    return [...this.sources.values()].map((t) => t.report);
  }

  /**
   * Returns true when the given source is tradable. Only HEALTHY sources are
   * tradable; DEGRADED, STALE, and DISCONNECTED sources are non-tradable.
   */
  isSourceTradable(source: string): boolean {
    const report = this.sources.get(source)?.report;
    if (!report) return false;
    return STATE_RULES[report.state].tradable;
  }

  /**
   * Returns true when the given source can participate in signal generation.
   * Only HEALTHY sources can generate signals.
   */
  canSourceGenerateSignals(source: string): boolean {
    const report = this.sources.get(source)?.report;
    if (!report) return false;
    return STATE_RULES[report.state].canGenerateSignals;
  }

  /**
   * Returns the set of source ids whose state is at least as restrictive as
   * the given threshold.
   */
  sourcesAtLeast(threshold: DataQualityState): string[] {
    const result: string[] = [];
    for (const [source, tracking] of this.sources) {
      if (isStateAtLeast(tracking.report.state, threshold)) {
        result.push(source);
      }
    }
    return result;
  }

  /** Remove tracking for a source (e.g. after successful reconnection). */
  removeSource(source: string): void {
    this.sources.delete(source);
  }

  /** Number of tracked sources. */
  get size(): number {
    return this.sources.size;
  }
}
