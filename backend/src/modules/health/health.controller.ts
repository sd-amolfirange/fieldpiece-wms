import { type BeforeApplicationShutdown, Controller, Get, HttpStatus, Logger, Res } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import type { FastifyReply } from "fastify";
import { Public } from "../../common/auth/decorators";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { RedisService } from "../../infra/redis/redis.service";

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), ms))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Liveness and readiness (Section 12.1). Internal network only; the gateway shouldn't expose these. */
@ApiTags("health")
@Public()
@SkipThrottle()
@Controller("health")
export class HealthController implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HealthController.name);
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  beforeApplicationShutdown(): void {
    this.shuttingDown = true;
    this.logger.log("Marked not-ready for shutdown");
  }

  @Get("live")
  @ApiOperation({ summary: "Liveness", description: "200 if the event loop responds. No dependency checks." })
  @ApiOkResponse({ description: "Alive" })
  live() {
    return { status: "ok" };
  }

  @Get("ready")
  @ApiOperation({
    summary: "Readiness",
    description: "Checks Postgres (1 s) and Redis. 503 while shutting down.",
  })
  @ApiOkResponse({ description: "Ready" })
  @ApiServiceUnavailableResponse({ description: "Not ready" })
  async ready(@Res({ passthrough: true }) reply: FastifyReply) {
    const [db, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, 1000).then(
        () => true,
        () => false,
      ),
      this.redis.isHealthy(),
    ]);
    const ok = db && redis && !this.shuttingDown;
    void reply.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? "ok" : "unavailable", checks: { db, redis, shuttingDown: this.shuttingDown } };
  }
}
