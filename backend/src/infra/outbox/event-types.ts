// Domain events written to the outbox, and the queues the relay routes them to (Section 12.2).

export const QUEUES = {
  email: "email",
  pdf: "pdf",
  import: "import",
  scan: "scan",
  integration: "integration",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const DOMAIN_EVENTS = [
  "registration.created",
  "registration.voided",
  "registration.import_requested",
  "claim.submitted",
  "claim.status_changed",
  "claim.approved",
  "claim.rejected",
  "claim.needs_info",
  "claim.sla_breached",
  "rma.status_changed",
  "attachment.uploaded",
] as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[number];

/** Which queues consume each event. An event can fan out to several queues. */
export const EVENT_ROUTES: Record<DomainEventType, readonly QueueName[]> = {
  "registration.created": [QUEUES.email, QUEUES.pdf],
  "registration.voided": [],
  "registration.import_requested": [QUEUES.import],
  "claim.submitted": [QUEUES.email],
  "claim.status_changed": [],
  "claim.approved": [QUEUES.email],
  "claim.rejected": [QUEUES.email],
  "claim.needs_info": [QUEUES.email],
  "claim.sla_breached": [QUEUES.email],
  "rma.status_changed": [],
  "attachment.uploaded": [QUEUES.scan],
};

/** Payload every queued job carries. Consumers de-duplicate by `eventId` (at-least-once delivery). */
export interface QueuedEvent<P = Record<string, unknown>> {
  eventId: string;
  type: DomainEventType;
  aggregate: string;
  aggregateId: string;
  payload: P;
  occurredAt: string;
}
