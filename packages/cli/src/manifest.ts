/**
 * ManifestWriter: tracks all files written during a session (audit logs,
 * reports, summaries) and writes a manifest file at shutdown.
 *
 * Acceptance criteria (issue #78):
 *   AC10: Manifest file listing all files written (audit logs, reports) at shutdown
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── Types ────────────────────────────────────────────────────────────

export interface ManifestEntry {
  /** Category of the file: audit-log, report-json, report-csv, report-txt,
   *  summary, manifest. */
  category:
    | "audit-log"
    | "report-json"
    | "report-csv"
    | "report-txt"
    | "promotion-evidence"
    | "summary"
    | "manifest";
  /** Absolute or relative path to the file. */
  path: string;
  /** File size in bytes (0 if unknown). */
  sizeBytes: number;
  /** Timestamp when the file was written (Unix ms). */
  writtenAtMs: number;
}

export interface ManifestData {
  /** Session identifier. */
  sessionId: string;
  /** Session start time (Unix ms). */
  startedAtMs: number;
  /** Session end time (Unix ms). */
  endedAtMs: number;
  /** All files written during the session. */
  files: ManifestEntry[];
  /** Total number of files. */
  totalFiles: number;
}

// ── ManifestWriter ───────────────────────────────────────────────────

/**
 * ManifestWriter: accumulates file entries during a session and writes
 * a manifest JSON at shutdown.
 */
export class ManifestWriter {
  private readonly sessionId: string;
  private readonly startedAtMs: number;
  private readonly nowMs: () => number;
  private readonly entries: ManifestEntry[] = [];

  constructor(opts: {
    sessionId: string;
    startedAtMs: number;
    nowMs?: () => number;
  }) {
    this.sessionId = opts.sessionId;
    this.startedAtMs = opts.startedAtMs;
    this.nowMs = opts.nowMs ?? (() => Date.now());
  }

  /** Total entries tracked. */
  get count(): number {
    return this.entries.length;
  }

  /** All tracked entries (read-only copy). */
  get files(): readonly ManifestEntry[] {
    return this.entries;
  }

  /**
   * Record a file that was written during the session.
   *
   * @param category - File category.
   * @param path - File path.
   * @param sizeBytes - File size (0 if unknown).
   */
  track(
    category: ManifestEntry["category"],
    path: string,
    sizeBytes: number = 0,
  ): void {
    this.entries.push({
      category,
      path,
      sizeBytes,
      writtenAtMs: this.nowMs(),
    });
  }

  /**
   * Write the manifest file to disk.
   *
   * @param manifestPath - Path to the manifest JSON file.
   */
  writeManifest(manifestPath: string): ManifestData {
    const endedAtMs = this.nowMs();

    const manifest: ManifestData = {
      sessionId: this.sessionId,
      startedAtMs: this.startedAtMs,
      endedAtMs,
      files: [...this.entries],
      totalFiles: this.entries.length,
    };

    const dir = dirname(manifestPath);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Directory may already exist.
    }

    // Track the manifest itself
    this.entries.push({
      category: "manifest",
      path: manifestPath,
      sizeBytes: 0,
      writtenAtMs: endedAtMs,
    });

    // Rebuild manifest with self-reference included
    manifest.files = [...this.entries];
    manifest.totalFiles = this.entries.length;

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");

    return manifest;
  }
}
