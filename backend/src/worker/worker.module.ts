import { type DynamicModule, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { AuthModule } from "../common/auth/auth.module";
import { loggerOptions } from "../common/observability/logger";
import { ConfigModule } from "../config/config.module";
import type { Env } from "../config/env";
import { OutboxModule } from "../infra/outbox/outbox.module";
import { PrismaModule } from "../infra/prisma/prisma.module";
import { RedisModule } from "../infra/redis/redis.module";
import { StorageModule } from "../infra/storage/storage.module";
import { AttachmentsModule } from "../modules/attachments";
import { AuditModule } from "../modules/audit";
import { ClaimsModule } from "../modules/claims";
import { RegistrationsModule } from "../modules/registrations";
import { RmaModule } from "../modules/rma";
import { MaintenanceService } from "./maintenance";
import { NotificationService } from "./notifications";
import { OutboxRelay } from "./outbox-relay";
import { WorkerRunner } from "./worker.runner";

/** Same image as the API, different entry point (Section 1.1). No HTTP controllers are mounted. */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot(loggerOptions(env)),
        PrismaModule,
        RedisModule,
        StorageModule,
        OutboxModule,
        AuthModule,
        AuditModule,
        AttachmentsModule,
        RegistrationsModule,
        ClaimsModule,
        RmaModule, // provides the RmaIssuer port ClaimsModule depends on
      ],
      providers: [OutboxRelay, NotificationService, MaintenanceService, WorkerRunner],
    };
  }
}
