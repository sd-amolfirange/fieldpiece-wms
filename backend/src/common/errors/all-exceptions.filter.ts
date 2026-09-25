import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError, type ErrorCode, type FieldErrors } from "./app-error";

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  /** Correlates with the log line and the X-Request-Id header. */
  requestId: string;
}

const BY_STATUS: Partial<Record<number, [ErrorCode, string]>> = {
  400: ["bad_request", "The request couldn't be read. Check the format."],
  401: ["unauthenticated", "Session expired. Sign in again."],
  403: ["forbidden", "You don't have access to this."],
  404: ["not_found", "Not found."],
  406: ["bad_request", "The requested format isn't available."],
  413: ["too_large", "The request is too large."],
  415: ["unsupported_type", "This content type isn't supported."],
  429: ["rate_limited", "Too many requests. Wait a minute, then try again."],
};

/**
 * Maps every error to the contract's error body. Never returns stack traces, SQL or internal hostnames:
 * unexpected errors get a generic message and are logged with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const requestId = String(request.id);

    const [status, body] = this.map(exception, requestId);
    if (status >= 500) {
      this.logger.error({ err: exception, requestId, route: request.routeOptions?.url }, "Unhandled error");
    }
    if (reply.sent) return; // a stream failed after the headers went out; nothing more can be sent
    void reply.status(status).header("Cache-Control", "no-store").send(body);
  }

  private map(exception: unknown, requestId: string): [number, ErrorBody] {
    if (exception instanceof AppError) {
      return [
        exception.status,
        { code: exception.code, message: exception.message, fieldErrors: exception.fieldErrors, requestId },
      ];
    }

    if (exception instanceof ThrottlerException) {
      const [code, message] = BY_STATUS[429]!;
      return [429, { code, message, requestId }];
    }

    // Expected constraint races surface here only if a service missed them; never leak the SQL.
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2025") return [404, { code: "not_found", message: "Not found.", requestId }];
      if (exception.code === "P2002" || exception.code === "P2034") {
        return [
          409,
          { code: "invalid_transition", message: "This changed in the meantime. Refresh and try again.", requestId },
        ];
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const known = BY_STATUS[status];
      if (known) return [status, { code: known[0], message: known[1], requestId }];
      if (status < 500) return [status, { code: "bad_request", message: exception.message, requestId }];
    }

    // Fastify's own errors (bad JSON, body too large, multipart limits) carry a statusCode.
    const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const [code, message] = BY_STATUS[statusCode] ?? BY_STATUS[400]!;
      return [statusCode, { code, message, requestId }];
    }

    return [500, { code: "server_error", message: "Something went wrong. Try again.", requestId }];
  }
}
