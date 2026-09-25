import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  INTEGRATION_STATUSES,
  INTEGRATION_SYSTEMS,
  type IntegrationDirection,
  type IntegrationMessage,
  type IntegrationStatus,
  type IntegrationSystem,
} from "@wms/domain";
import { nextId } from "../../common/db/ids";
import { AppError } from "../../common/errors/app-error";
import {
  listQuery,
  pageArgs,
  type Paginated,
  queryEnum,
  type RawQuery,
  resolveSort,
} from "../../common/http/list-query";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";
import { toIntegrationMessage } from "../../domain/views";

export interface LogEntry {
  system: IntegrationSystem;
  direction: IntegrationDirection;
  /** e.g. "service_request", "job_result", "claim_submission", "oem_decision", "finance_posting", "crm_update" */
  type: string;
  payload: unknown;
  refId?: string;
  status?: IntegrationStatus;
  lastError?: string;
}

const DIRECTIONS: readonly IntegrationDirection[] = ["IN", "OUT"];

type OrderBy = Prisma.IntegrationMessageOrderByWithRelationInput;
const SORTS: Record<string, (dir: Prisma.SortOrder) => OrderBy> = {
  id: (dir) => ({ id: dir }),
  system: (dir) => ({ system: dir }),
  direction: (dir) => ({ direction: dir }),
  type: (dir) => ({ type: dir }),
  status: (dir) => ({ status: dir }),
  attempts: (dir) => ({ attempts: dir }),
  refId: (dir) => ({ refId: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
};

/**
 * The integration log (A12): every message exchanged with CRM, ERP, Finance, the service system, the OEM and the
 * registration mailbox, written in the same transaction as the business change.
 *
 * TODO [CONFIRM integrations]: outbound messages are recorded as delivered (SUCCESS) because no external system is
 * connected yet. When one is, write them as PENDING here and let a dispatcher deliver them and set the status.
 */
@Injectable()
export class IntegrationLog {
  constructor(private readonly prisma: PrismaService) {}

  async log(db: Db, entry: LogEntry, now: Date): Promise<string> {
    const id = await nextId(db, "MSG");
    await db.integrationMessage.create({
      data: {
        id,
        system: entry.system,
        direction: entry.direction,
        type: entry.type,
        status: entry.status ?? "SUCCESS",
        payload: toJson(entry.payload),
        attempts: 1,
        lastError: entry.lastError,
        refId: entry.refId,
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }

  async list(query: RawQuery): Promise<Paginated<IntegrationMessage>> {
    const list = listQuery(query);
    const q = list.q;
    const where: Prisma.IntegrationMessageWhereInput = {
      system: queryEnum(query, "system", INTEGRATION_SYSTEMS),
      direction: queryEnum(query, "direction", DIRECTIONS),
      status: queryEnum(query, "status", INTEGRATION_STATUSES),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: "insensitive" } },
              { type: { contains: q, mode: "insensitive" } },
              { refId: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.integrationMessage.count({ where }),
      this.prisma.integrationMessage.findMany({
        where,
        // Same instant: keep the order they were written in.
        orderBy: [resolveSort(list.sort, SORTS, "-createdAt"), { id: "asc" }],
        ...pageArgs(list),
      }),
    ]);
    return { items: rows.map(toIntegrationMessage), total, page: list.page, pageSize: list.pageSize };
  }

  async retry(id: string, now: Date): Promise<IntegrationMessage> {
    // TODO [CONFIRM integrations]: hand the message to the real dispatcher. With no external system connected, a
    // retry is recorded as delivered.
    const updated = await this.prisma.integrationMessage.updateMany({
      where: { id, status: "FAILED" },
      data: { status: "SUCCESS", attempts: { increment: 1 }, lastError: null, updatedAt: now },
    });
    const message = await this.prisma.integrationMessage.findUnique({ where: { id } });
    if (!message) throw AppError.notFound("Message");
    if (!updated.count) throw AppError.conflict("not_failed", "Only failed messages can be retried.");
    return toIntegrationMessage(message);
  }
}

/** JSON-safe copy for jsonb columns (drops undefined, like the API's JSON responses). */
export const toJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
