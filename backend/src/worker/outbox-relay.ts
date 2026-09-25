import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { toJson } from "../common/json";
import {
  DOMAIN_EVENTS,
  type DomainEventType,
  EVENT_ROUTES,
  type QueueName,
  type QueuedEvent,
} from "../infra/outbox/event-types";
import { PrismaService } from "../infra/prisma/prisma.service";

const BATCH = 100;

interface OutboxRow {
  id: bigint;
  aggregate: string;
  aggregate_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

const isKnown = (type: string): type is DomainEventType =>
  (DOMAIN_EVENTS as readonly string[]).includes(type);

/**
 * Outbox relay (Section 12.2): reads unpublished events with FOR UPDATE SKIP LOCKED in batches of 100,
 * publishes them to BullMQ and marks them published. At-least-once: the BullMQ job ID is the outbox ID,
 * so a re-publish after a crash is de-duplicated by the queue, and consumers are idempotent anyway.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Publishes one batch. Returns how many events were relayed. */
  async relayOnce(queues: Record<QueueName, Queue>): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>`
        SELECT id, aggregate, aggregate_id, type, payload, created_at
        FROM outbox_events
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return 0;

      for (const row of rows) {
        if (!isKnown(row.type)) {
          this.logger.error({ id: row.id.toString(), type: row.type }, "Unknown outbox event type; skipping");
          continue;
        }
        const event: QueuedEvent = {
          eventId: row.id.toString(),
          type: row.type,
          aggregate: row.aggregate,
          aggregateId: row.aggregate_id,
          payload: toJson(row.payload) as Record<string, unknown>,
          occurredAt: row.created_at.toISOString(),
        };
        for (const queue of EVENT_ROUTES[row.type]) {
          await queues[queue].add(row.type, event, { jobId: `outbox-${row.id}-${queue}` });
        }
      }
      await tx.outboxEvent.updateMany({
        where: { id: { in: rows.map((r) => r.id) } },
        data: { publishedAt: new Date(), attempts: { increment: 1 } },
      });
      return rows.length;
    });
  }
}
