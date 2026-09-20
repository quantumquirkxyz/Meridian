import { describe, test, expect, beforeEach, vi } from "bun:test";
import type {
  CanaryControlCommand,
  CanaryControlPort,
  CanaryControlResult,
  CanaryControlStatus,
} from "@agenttrading/contracts";
import {
  CanaryControlTuiModel,
  CANARY_CONTROL_COMMAND_DESCRIPTORS,
} from "../src/canary-control-tui.ts";

// ── Mock session ─────────────────────────────────────────────────────

function makeMockStatus(overrides: Partial<CanaryControlStatus> = {}): CanaryControlStatus {
  return {
    running: false,
    mode: "NORMAL",
    state: "IDLE",
    killSwitchActive: false,
    openOrders: 0,
    ordersToday: 0,
    ordersThisWeek: 0,
    capitalDeployedUsd: 0,
    capitalRemainingUsd: 10_000,
    dailyPnlUsd: 0,
    weeklyPnlUsd: 0,
    orphanOrderCount: 0,
    reconciliationUnresolved: false,
    paused: false,
    ...overrides,
  };
}

function makeMockResult(
  command: CanaryControlCommand,
  statusOverrides: Partial<CanaryControlStatus> = {},
  ok = true,
): CanaryControlResult {
  return {
    ...makeMockStatus(statusOverrides),
    command,
    ok,
    error: ok ? undefined : "test error",
  };
}

function createMockPort(
  controlFn?: (cmd: CanaryControlCommand) => CanaryControlResult,
  initialStatus?: CanaryControlStatus,
): CanaryControlPort & { setStatus: (s: CanaryControlStatus) => void } {
  let status = initialStatus ?? makeMockStatus();
  const port = {
    get status() { return status; },
    control: controlFn ?? ((cmd: CanaryControlCommand) => {
      const result = makeMockResult(cmd, { running: cmd === "start" });
      const { command: _cmd, ...statusFields } = result;
      status = { ...status, ...statusFields };
      return result;
    }),
    setStatus: (s: CanaryControlStatus) => { status = s; },
  };
  return port;
}

// ── CanaryControlCommandRow tests ────────────────────────────────────

describe("CANARY_CONTROL_COMMAND_DESCRIPTORS", () => {
  test("has one row per command", () => {
    expect(CANARY_CONTROL_COMMAND_DESCRIPTORS.length).toBe(8);
  });

  test("each row has command, hotkey, label, and dangerous flag", () => {
    for (const row of CANARY_CONTROL_COMMAND_DESCRIPTORS) {
      expect(typeof row.command).toBe("string");
      expect(typeof row.hotkey).toBe("string");
      expect(typeof row.label).toBe("string");
      expect(typeof row.dangerous).toBe("boolean");
    }
  });

  test("cancel-all and halt are dangerous", () => {
    const dangerous = CANARY_CONTROL_COMMAND_DESCRIPTORS.filter((r) => r.dangerous);
    expect(dangerous.map((r) => r.command)).toEqual(["cancel-all", "halt"]);
  });

  test("non-dangerous commands are not marked dangerous", () => {
    const safe = CANARY_CONTROL_COMMAND_DESCRIPTORS.filter((r) => !r.dangerous);
    expect(safe.map((r) => r.command)).toEqual([
      "start", "stop", "cash-only", "reduce-only", "pause", "resume",
    ]);
  });
});

// ── CanaryControlTuiModel ────────────────────────────────────────────

describe("CanaryControlTuiModel", () => {
  let port: ReturnType<typeof createMockPort>;
  let model: CanaryControlTuiModel;

  beforeEach(() => {
    port = createMockPort();
    model = new CanaryControlTuiModel(port);
  });

  test("status returns the session status", () => {
    expect(model.status).toBe(port.status);
  });

  test("view has title, statusRows, commandRows, footer", () => {
    const view = model.view;
    expect(view.title).toBe("Meridian Live Canary Control");
    expect(view.statusRows.length).toBeGreaterThan(0);
    expect(view.commandRows.length).toBe(8);
    expect(typeof view.footer).toBe("string");
  });

  test("statusRows include all expected labels", () => {
    const labels = model.view.statusRows.map((r) => r.label);
    expect(labels).toContain("running");
    expect(labels).toContain("mode");
    expect(labels).toContain("state");
    expect(labels).toContain("kill switch");
    expect(labels).toContain("open orders");
    expect(labels).toContain("capital deployed");
    expect(labels).toContain("capital remaining");
    expect(labels).toContain("daily PnL");
    expect(labels).toContain("weekly PnL");
    expect(labels).toContain("orphan orders");
    expect(labels).toContain("reconciliation");
  });

  test("dispatch delegates to session.control()", () => {
    const controlSpy = vi.fn().mockReturnValue(makeMockResult("halt", { mode: "HALT" }));
    port = createMockPort(controlSpy);
    model = new CanaryControlTuiModel(port);

    const result = model.dispatch("halt");
    expect(controlSpy).toHaveBeenCalledWith("halt");
    expect(result.ok).toBe(true);
  });

  test("dispatch sets lastError on failed result", () => {
    const controlSpy = vi.fn().mockReturnValue(makeMockResult("halt", {}, false));
    port = createMockPort(controlSpy);
    model = new CanaryControlTuiModel(port);

    model.dispatch("halt");
    expect(model.view.footer).toBe("test error");
  });

  test("dispatch clears lastError on success", () => {
    const controlSpy = vi.fn()
      .mockReturnValueOnce(makeMockResult("halt", {}, false))
      .mockReturnValueOnce(makeMockResult("start", { running: true }));
    port = createMockPort(controlSpy);
    model = new CanaryControlTuiModel(port);

    model.dispatch("halt");
    expect(model.view.footer).toBe("test error");

    model.dispatch("start");
    expect(model.view.footer).toContain("Hotkeys");
  });

  test("dispatch rethrows exceptions and sets lastError", () => {
    const controlSpy = vi.fn().mockImplementation(() => {
      throw new Error("connection lost");
    });
    port = createMockPort(controlSpy);
    model = new CanaryControlTuiModel(port);

    expect(() => model.dispatch("start")).toThrow("connection lost");
    expect(model.view.footer).toBe("connection lost");
  });

  test("dispatch rethrows non-Error exceptions", () => {
    const controlSpy = vi.fn().mockImplementation(() => {
      throw "string error";
    });
    port = createMockPort(controlSpy);
    model = new CanaryControlTuiModel(port);

    expect(() => model.dispatch("start")).toThrow("string error");
    expect(model.view.footer).toBe("unknown control error");
  });

  test("start triggers loopRunner.start()", () => {
    const loopRunner = { start: vi.fn(), stop: vi.fn() };
    model = new CanaryControlTuiModel(port, { loopRunner });

    model.dispatch("start");
    expect(loopRunner.start).toHaveBeenCalled();
    expect(loopRunner.stop).not.toHaveBeenCalled();
  });

  test("stop triggers loopRunner.stop()", () => {
    const loopRunner = { start: vi.fn(), stop: vi.fn() };
    model = new CanaryControlTuiModel(port, { loopRunner });

    model.dispatch("stop");
    expect(loopRunner.stop).toHaveBeenCalled();
    expect(loopRunner.start).not.toHaveBeenCalled();
  });

  test("halt triggers loopRunner.stop() via mode=HALT", () => {
    const controlSpy = vi.fn().mockReturnValue(makeMockResult("halt", { mode: "HALT" }));
    port = createMockPort(controlSpy);
    const loopRunner = { start: vi.fn(), stop: vi.fn() };
    model = new CanaryControlTuiModel(port, { loopRunner });

    model.dispatch("halt");
    expect(loopRunner.stop).toHaveBeenCalled();
  });

  test("dispatch without loopRunner does not throw", () => {
    model = new CanaryControlTuiModel(port);
    expect(() => model.dispatch("start")).not.toThrow();
  });

  test("render produces a string with title, status, commands, footer", () => {
    const output = model.render();
    expect(output).toContain("Meridian Live Canary Control");
    expect(output).toContain("running:");
    expect(output).toContain("mode:");
    expect(output).toContain("[s] Start canary");
    expect(output).toContain("Hotkeys");
  });
});

// ── Emphasis logic ───────────────────────────────────────────────────

describe("CanaryControlTuiModel emphasis", () => {
  test("HALT mode shows danger emphasis", () => {
    const port = createMockPort(undefined, makeMockStatus({ mode: "HALT" }));
    const model = new CanaryControlTuiModel(port);

    const modeRow = model.view.statusRows.find((r) => r.label === "mode");
    expect(modeRow?.emphasis).toBe("danger");
  });

  test("kill switch active shows danger emphasis", () => {
    const port = createMockPort(undefined, makeMockStatus({ killSwitchActive: true }));
    const model = new CanaryControlTuiModel(port);

    const killRow = model.view.statusRows.find((r) => r.label === "kill switch");
    expect(killRow?.emphasis).toBe("danger");
    expect(killRow?.value).toBe("ACTIVE");
  });

  test("non-NORMAL mode shows warning emphasis", () => {
    const port = createMockPort(undefined, makeMockStatus({ mode: "REDUCE_ONLY" }));
    const model = new CanaryControlTuiModel(port);

    const modeRow = model.view.statusRows.find((r) => r.label === "mode");
    expect(modeRow?.emphasis).toBe("warning");
  });

  test("negative daily PnL shows warning", () => {
    const port = createMockPort(undefined, makeMockStatus({ dailyPnlUsd: -50 }));
    const model = new CanaryControlTuiModel(port);

    const pnlRow = model.view.statusRows.find((r) => r.label === "daily PnL");
    expect(pnlRow?.emphasis).toBe("warning");
  });

  test("orphan orders show danger", () => {
    const port = createMockPort(undefined, makeMockStatus({ orphanOrderCount: 2 }));
    const model = new CanaryControlTuiModel(port);

    const orphanRow = model.view.statusRows.find((r) => r.label === "orphan orders");
    expect(orphanRow?.emphasis).toBe("danger");
  });

  test("unresolved reconciliation shows danger", () => {
    const port = createMockPort(undefined, makeMockStatus({ reconciliationUnresolved: true }));
    const model = new CanaryControlTuiModel(port);

    const reconRow = model.view.statusRows.find((r) => r.label === "reconciliation");
    expect(reconRow?.emphasis).toBe("danger");
    expect(reconRow?.value).toBe("UNRESOLVED");
  });

  test("zero capital remaining shows danger", () => {
    const port = createMockPort(undefined, makeMockStatus({ capitalRemainingUsd: 0 }));
    const model = new CanaryControlTuiModel(port);

    const capRow = model.view.statusRows.find((r) => r.label === "capital remaining");
    expect(capRow?.emphasis).toBe("danger");
  });

  test("paused shows warning", () => {
    const port = createMockPort(undefined, makeMockStatus({ paused: true }));
    const model = new CanaryControlTuiModel(port);

    const pausedRow = model.view.statusRows.find((r) => r.label === "paused");
    expect(pausedRow?.emphasis).toBe("warning");
  });
});
