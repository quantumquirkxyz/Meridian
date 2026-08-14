import {
  PERMISSIONS_NEVER_GRANTED_TO_AGENTS,
  type Permission,
} from "@agenttrading/contracts";

/**
 * PermissionRegistry: the per-module / per-agent permission model (ADR-0003,
 * ARCHITECTURE.md:55-59). Every StateGraph transition carries
 * `requiredPermissions`; the acting actor must hold them all or the transition
 * is rejected with a PERMISSION_DENIED audit before any guard runs.
 *
 * The registry stores an actor id -> set of Permissions. Actor ids are fixed
 * module/agent names, never human-passable free strings. Agents are granted
 * only observation/proposal permissions; the execution-authority permissions
 * (APPROVE_RISK, SUBMIT_ORDER, SIGN_TRANSACTION, MOVE_FUNDS, MODIFY_RISK_LIMITS)
 * are never granted to agents (PERMISSIONS_NEVER_GRANTED_TO_AGENTS).
 */
export class PermissionRegistry {
  private readonly byActor = new Map<string, Set<Permission>>();

  register(actor: string, permissions: readonly Permission[]): void {
    this.byActor.set(actor, new Set(permissions));
  }

  grant(actor: string, permission: Permission): void {
    const set = this.byActor.get(actor) ?? new Set<Permission>();
    set.add(permission);
    this.byActor.set(actor, set);
  }

  revoke(actor: string, permission: Permission): void {
    this.byActor.get(actor)?.delete(permission);
  }

  has(actor: string, permission: Permission): boolean {
    return this.byActor.get(actor)?.has(permission) ?? false;
  }

  hasAll(actor: string, required: readonly Permission[]): boolean {
    return required.every((permission) => this.has(actor, permission));
  }

  /** Permissions a given actor currently holds (stable copy). */
  permissionsFor(actor: string): readonly Permission[] {
    return [...(this.byActor.get(actor) ?? [])];
  }

  actors(): readonly string[] {
    return [...this.byActor.keys()];
  }
}

/**
 * True when a permission is one of the execution-authority permissions that
 * ARCHITECTURE.md:57 forbids granting to agents.
 */
export function isExecutionPermission(permission: Permission): boolean {
  return (PERMISSIONS_NEVER_GRANTED_TO_AGENTS as readonly Permission[]).includes(
    permission,
  );
}

/**
 * Structural enforcement of user story 28: no AI agent holds
 * APPROVE_RISK / SUBMIT_ORDER / SIGN_TRANSACTION / MOVE_FUNDS /
 * MODIFY_RISK_LIMITS. Returns the list of offending agents (empty when the
 * boundary holds). Used by the permission-boundary tests and by
 * `assertAgentPermissionsSafe`.
 */
export function agentsHoldingExecutionPermissions(
  registry: PermissionRegistry,
  agentIds: readonly string[],
): string[] {
  return agentIds.filter((agent) =>
    (PERMISSIONS_NEVER_GRANTED_TO_AGENTS as readonly Permission[]).some(
      (permission) => registry.has(agent, permission),
    ),
  );
}

/** Throws if any agent holds an execution-authority permission. */
export function assertNoAgentHoldsExecutionPermissions(
  registry: PermissionRegistry,
  agentIds: readonly string[],
): void {
  const offenders = agentsHoldingExecutionPermissions(registry, agentIds);
  if (offenders.length > 0) {
    throw new Error(
      `permission boundary violated: agents ${offenders.join(", ")} hold ` +
        `execution-authority permissions`,
    );
  }
}