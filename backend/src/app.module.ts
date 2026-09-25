import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { ZodValidationPipe } from "nestjs-zod";
import { AuthModule } from "./common/auth/auth.module";
import { AuthGuard } from "./common/auth/auth.guard";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter";
import { IdempotencyInterceptor } from "./common/http/idempotency.interceptor";
import { AppThrottlerGuard, throttlerOptions } from "./common/http/throttling";
import { loggerOptions } from "./common/observability/logger";
import type { Clock } from "./common/time/clock";
import { ConfigModule } from "./config/config.module";
import type { Env } from "./config/env";
import { OutboxModule } from "./infra/outbox/outbox.module";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";
import { RedisService } from "./infra/redis/redis.service";
import { StorageModule } from "./infra/storage/storage.module";
import { AttachmentsModule } from "./modules/attachments";
import { AuditModule } from "./modules/audit";
import { ClaimsModule } from "./modules/claims";
import { CustomersModule } from "./modules/customers";
import { DevIdpModule } from "./modules/dev-idp";
import { HealthModule } from "./modules/health";
import { PoliciesModule } from "./modules/policies";
import { ProductsModule } from "./modules/products";
import { RegistrationsModule } from "./modules/registrations";
import { ReportsModule } from "./modules/reports";
import { RmaModule } from "./modules/rma";
import { UsersModule } from "./modules/users";
import { WarrantyModule } from "./modules/warranty";

@Module({})
export class AppModule {
  static forRoot(env: Env, clock?: Clock): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env, clock),
        LoggerModule.forRoot(loggerOptions(env)),
        PrismaModule,
        RedisModule,
        StorageModule,
        OutboxModule,
        AuthModule,
        ThrottlerModule.forRootAsync({
          inject: [RedisService],
          useFactory: (redis: RedisService) => throttlerOptions(redis.client),
        }),
        AuditModule,
        HealthModule,
        UsersModule,
        DevIdpModule.register(env.DEV_IDP_ENABLED),
        ProductsModule,
        PoliciesModule,
        WarrantyModule,
        CustomersModule,
        AttachmentsModule,
        RegistrationsModule,
        ClaimsModule,
        RmaModule,
        ReportsModule,
      ],
      providers: [
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Order matters: authenticate first so the throttler can track per user.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    };
  }
}
