import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Tx } from "../prisma/prisma.service";
import type { DomainEventType } from "./event-types";

export interface DomainEvent {
  aggregate: string;
  aggregateId: string;
  type: DomainEventType;
  payload: Prisma.InputJsonObject;
}

/**
 * Transactional outbox writer (ADR-006). Always call inside the same transaction as the state change,
 * so the event exists if, and only if, the change committed. The worker relays it to BullMQ.
 */
@Injectable()
export class OutboxService {
  async add(tx: Tx, event: DomainEvent): Promise<void> {
    await tx.outboxEvent.create({ data: event });
  }

  async addMany(tx: Tx, events: DomainEvent[]): Promise<void> {
    if (events.length) await tx.outboxEvent.createMany({ data: events });
  }
}
