import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { catchError, from, mergeMap, type Observable, of } from "rxjs";
import { PrismaService } from "../../infra/prisma/prisma.service";
import type { AuthenticatedRequest } from "../auth/decorators";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * Idempotency-Key support for POSTs (Section 6.5). The key and a request hash are stored for 24 h;
 * a replay returns the stored response, the same key with a different body returns 422, and a replay
 * while the first request is still running returns 409. Failed requests release the key so a retry works.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const rawKey = request.headers["idempotency-key"];
    const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (request.method !== "POST" || !key || !request.user) return next.handle();

    if (!KEY_PATTERN.test(key)) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        "Idempotency-Key must be a UUID.",
      );
    }

    const userId = request.user.id;
    const requestHash = createHash("sha256")
      .update(`${request.method} ${request.url} ${stableStringify(request.body ?? null)}`)
      .digest("hex");
    const id = { userId_key: { userId, key } };

    const existing = await this.prisma.idempotencyKey.findUnique({ where: id });
    if (existing) return of(this.replay(existing, requestHash));

    try {
      await this.prisma.idempotencyKey.create({ data: { userId, key, requestHash } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw this.inProgress();
      }
      throw err;
    }

    const statusCode =
      this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? HttpStatus.CREATED;

    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.prisma.idempotencyKey
            .update({
              where: id,
              data: { responseCode: statusCode, responseBody: (body ?? null) as Prisma.InputJsonValue },
            })
            .then(() => body),
        ),
      ),
      catchError((err: unknown) =>
        from(this.prisma.idempotencyKey.delete({ where: id }).catch(() => undefined)).pipe(
          mergeMap(() => {
            throw err;
          }),
        ),
      ),
    );
  }

  private replay(
    existing: { requestHash: string; responseCode: number | null; responseBody: unknown },
    hash: string,
  ) {
    if (existing.requestHash !== hash) {
      throw AppError.unprocessable(
        ErrorCode.IDEMPOTENCY_KEY_REUSED,
        "This Idempotency-Key was already used for a different request.",
      );
    }
    if (existing.responseCode === null) throw this.inProgress();
    return existing.responseBody;
  }

  private inProgress(): AppError {
    return AppError.conflict(ErrorCode.IDEMPOTENCY_IN_PROGRESS, "This request is already being processed.");
  }
}
