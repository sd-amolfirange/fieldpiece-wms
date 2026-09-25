import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { type Job, Queue, Worker } from "bullmq";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { QUEUES, type QueueName, type QueuedEvent } from "../infra/outbox/event-types";
import { AttachmentsService } from "../modules/attachments";
import { SlaService } from "../modules/claims";
import { CertificateService, type ImportJob, RegistrationImportService } from "../modules/registrations";
import { MaintenanceService } from "./maintenance";
import { NotificationService } from "./notifications";
import { OutboxRelay } from "./outbox-relay";

// Queue concurrency per Section 10; retries, backoff and dead-letter per Section 12.2.
const CONCURRENCY: Record<QueueName, number> = {
  email: 20,
  pdf: 4,
  import: 2,
  scan: 8,
  integration: 5,
  maintenance: 1,
};
const RELAY_IDLE_MS = 1000;
const DEAD_LETTER = "dead-letter";

type Handler = (job: Job<QueuedEvent>) => Promise<unknown>;

@Injectable()
export class WorkerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(WorkerRunner.name);
  private readonly connection: { url: string; maxRetriesPerRequest: null };
  private queues!: Record<QueueName, Queue>;
  private deadLetter!: Queue;
  private workers: Worker[] = [];
  private relaying = true;
  private relayLoop: Promise<void> | null = null;

  constructor(
    @Inject(ENV) env: Env,
    private readonly relay: OutboxRelay,
    private readonly notifications: NotificationService,
    private readonly certificates: CertificateService,
    private readonly attachments: AttachmentsService,
    private readonly imports: RegistrationImportService,
    private readonly sla: SlaService,
    private readonly maintenance: MaintenanceService,
  ) {
    // BullMQ requires maxRetriesPerRequest: null on its connections.
    this.connection = { url: env.REDIS_URL, maxRetriesPerRequest: null };
  }

  async onApplicationBootstrap(): Promise<void> {
    const opts = { connection: this.connection };
    this.queues = Object.fromEntries(
      Object.values(QUEUES).map((name) => [
        name,
        new Queue(name, {
          ...opts,
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: 1000,
            removeOnFail: false,
          },
        }),
      ]),
    ) as Record<QueueName, Queue>;
    this.deadLetter = new Queue(DEAD_LETTER, opts);

    const handlers: Record<QueueName, Handler> = {
      email: (job) => this.notifications.handle(job.data),
      pdf: (job) => this.certificates.generate(String(job.data.payload.registrationId)),
      scan: (job) => this.attachments.scan(String(job.data.payload.attachmentId)),
      import: (job) => this.imports.run(job.data.payload as unknown as ImportJob),
      integration: () => Promise.resolve(), // TODO: ERP / CRM / carrier sync [CONFIRM integrations]
      maintenance: (job) => this.runMaintenance(job.name),
    };

    for (const [name, handler] of Object.entries(handlers) as [QueueName, Handler][]) {
      const worker = new Worker(name, handler, { ...opts, concurrency: CONCURRENCY[name] });
      worker.on("failed", (job, err) => void this.onFailed(name, job, err));
      this.workers.push(worker);
    }

    await this.queues.maintenance.upsertJobScheduler(
      "sla-breach-scan",
      { every: 15 * 60_000 },
      { name: "sla" },
    );
    await this.queues.maintenance.upsertJobScheduler(
      "housekeeping",
      { pattern: "0 3 * * *", tz: "UTC" },
      { name: "housekeeping" },
    );

    this.relayLoop = this.runRelay();
    this.logger.log("Worker started");
  }

  /** Graceful shutdown (Section 12.1): stop relaying, let workers finish their current job, close queues. */
  async onApplicationShutdown(): Promise<void> {
    this.relaying = false;
    await this.relayLoop;
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...Object.values(this.queues), this.deadLetter].map((q) => q.close()));
    this.logger.log("Worker stopped");
  }

  private async runRelay(): Promise<void> {
    while (this.relaying) {
      try {
        const relayed = await this.relay.relayOnce(this.queues);
        if (relayed === 0) await new Promise((resolve) => setTimeout(resolve, RELAY_IDLE_MS));
      } catch (err) {
        this.logger.error({ err }, "Outbox relay failed; retrying");
        await new Promise((resolve) => setTimeout(resolve, RELAY_IDLE_MS * 5));
      }
    }
  }

  private async runMaintenance(name: string): Promise<void> {
    if (name === "sla") await this.sla.flagBreaches();
    if (name === "housekeeping") await this.maintenance.purge();
  }

  /** After the last attempt, park the job in the dead-letter queue. A non-empty DLQ should page (Section 12.4). */
  private async onFailed(queue: QueueName, job: Job | undefined, err: Error): Promise<void> {
    this.logger.warn({ queue, jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, "Job failed");
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await this.deadLetter.add(
        `${queue}:${job.name}`,
        { queue, data: job.data as unknown, error: err.message },
        { jobId: `dlq-${queue}-${job.id}` },
      );
      this.logger.error({ queue, jobId: job.id }, "Job moved to dead-letter queue");
    }
  }
}
