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
 * module/agent names, never human-passable free strings. The registry is built
 * with the set of agent ids; registering or granting an execution-authority
 * permission (APPROVE_RISK, SUBMIT_ORDER, SIGN_TRANSACTION, MOVE_FUNDS,
 * MODIFY_RISK_LIMITS) to an agent throws immediately, so the boundary of
 * ARCHITECTURE.md:57 is enforced at runtime rather than by convention.
 */
export class PermissionRegistry {
  private readonly byActor = new Map<string, Set<Permission>>();
  private readonly agentIds: ReadonlySet<string>;

  constructor(agentIds: readonly string[] = []) {
    this.agentIds = new Set(agentIds);
  }

  register(actor: string, permissions: readonly Permission[]): void {
    this.assertAgentSafe(actor, permissions);
    this.byActor.set(actor, new Set(permissions));
  }

  grant(actor: string, permission: Permission): void {
    this.assertAgentSafe(actor, [permission]);
    const set = this.byActor.get(actor) ?? new Set<Permission>();
    set.add(permission);
    this.byActor.set(actor, set);
  }

  has(actor: string, permission: Permission): boolean {
    return this.byActor.get(actor)?.has(permission) ?? false;
  }

  hasAll(actor: string, required: readonly Permission[]): boolean {
    return required.every((permission) => this.has(actor, permission));
  }

  private assertAgentSafe(
    actor: string,
    permissions: readonly Permission[],
  ): void {
    if (!this.agentIds.has(actor)) {
      return;
    }
    const forbidden = (
      PERMISSIONS_NEVER_GRANTED_TO_AGENTS as readonly Permission[]
    ).filter((permission) => permissions.includes(permission));
    if (forbidden.length > 0) {
      throw new Error(
        `permission boundary violated: agent ${actor} cannot be granted ` +
          `${forbidden.join(", ")}`,
      );
    }
  }
}

/**
 * Structural enforcement of user story 28: no AI agent holds
 * APPROVE_RISK / SUBMIT_ORDER / SIGN_TRANSACTION / MOVE_FUNDS /
 * MODIFY_RISK_LIMITS. Returns the list of offending agents (empty when the
 * boundary holds). Belt-and-braces on top of the registry's runtime check:
 * it can also catch a registry constructed without its agent ids.
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