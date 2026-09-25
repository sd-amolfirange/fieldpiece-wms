import { Injectable, Logger } from "@nestjs/common";
import type { RequestContext } from "../../common/auth/auth-user";
import { toJson } from "../../common/json";
import { PrismaService, type Tx } from "../../infra/prisma/prisma.service";

export interface AuditEntry {
  action: string; // e.g. claim.status_changed
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Actions that also alert a monitored channel (Section 11.7). */
const ALERTING_ACTIONS = new Set([
  "user.roles_changed",
  "user.deactivated",
  "registration.voided",
  "policy.created",
  "policy.updated",
]);

export interface AuditRow {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorIp: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an audit row inside the caller's transaction. Pass only the fields that changed; never full
   * addresses or contact details (Section 11.5).
   */
  async record(tx: Tx, ctx: RequestContext | null, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: ctx?.user.id ?? null,
        actorIp: ctx?.ip ?? null,
        requestId: ctx?.requestId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        before: entry.before === undefined ? undefined : toJson(entry.before),
        after: entry.after === undefined ? undefined : toJson(entry.after),
      },
    });
    if (ALERTING_ACTIONS.has(entry.action)) {
      // TODO: forward to the monitored channel (Teams / Slack webhook) once chosen.
      this.logger.warn(
        { alert: true, action: entry.action, entityId: entry.entityId, actorId: ctx?.user.id },
        "Admin action",
      );
    }
  }

  /** Keyset pagination, newest first (Section 6.3). */
  async list(filter: { entity?: string; entityId?: string; after?: bigint; limit: number }) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entity: filter.entity,
        entityId: filter.entityId,
        id: filter.after === undefined ? undefined : { lt: filter.after },
      },
      orderBy: { id: "desc" },
      take: filter.limit + 1,
    });
    const page = rows.slice(0, filter.limit);
    const items: AuditRow[] = page.map((r) => ({
      id: r.id.toString(),
      occurredAt: r.occurredAt.toISOString(),
      actorId: r.actorId,
      actorIp: r.actorIp,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      requestId: r.requestId,
    }));
    return { items, nextCursor: rows.length > filter.limit ? (page.at(-1)?.id.toString() ?? null) : null };
  }
}
