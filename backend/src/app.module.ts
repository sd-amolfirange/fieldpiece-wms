import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AllExceptionsFilter } from "./common/errors/all-exceptions.filter";
import {
  AppThrottlerGuard,
  InMemoryThrottlerStorage,
  ThrottlerStorageModule,
  throttlerOptions,
} from "./common/http/throttling";
import { loggerOptions } from "./common/observability/logger";
import type { Clock } from "./common/time/clock";
import { ConfigModule, ENV } from "./config/config.module";
import type { Env } from "./config/env";
import { PrismaModule } from "./infra/prisma/prisma.module";
import { RedisModule } from "./infra/redis/redis.module";
import { RedisService } from "./infra/redis/redis.service";
import { StorageModule } from "./infra/storage/storage.module";
import { AuthGuard, AuthModule } from "./modules/auth";
import { CatalogModule } from "./modules/catalog";
import { ClaimsModule } from "./modules/claims";
import { DashboardModule } from "./modules/dashboard";
import { DemoModule } from "./modules/demo";
import { FilesModule } from "./modules/files";
import { HealthModule } from "./modules/health";
import { IntakeModule } from "./modules/intake";
import { IntegrationsModule } from "./modules/integrations";
import { NotificationsModule } from "./modules/notifications";
import { RegistrationsModule } from "./modules/registrations";
import { UnitsModule } from "./modules/units";

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
        ThrottlerStorageModule,
        ThrottlerModule.forRootAsync({
          inject: [ENV, RedisService, InMemoryThrottlerStorage],
          useFactory: (e: Env, redis: RedisService, memory: InMemoryThrottlerStorage) =>
            throttlerOptions(e, redis.client, memory),
        }),
        HealthModule,
        AuthModule,
        CatalogModule,
        FilesModule,
        NotificationsModule,
        IntegrationsModule,
        UnitsModule,
        RegistrationsModule,
        ClaimsModule,
        IntakeModule,
        DashboardModule,
        // Demo accounts and the simulator only exist when enabled (refused in production by env validation).
        ...(env.DEMO_FEATURES_ENABLED ? [DemoModule] : []),
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        // Order matters: authenticate first so the rate limiter can count per user.
        { provide: APP_GUARD, useExisting: AuthGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    };
  }
}
