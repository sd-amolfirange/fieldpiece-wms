import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ZodValidationException } from "nestjs-zod";
import type { ZodError } from "zod";
import { AppError, type FieldErrors } from "./app-error";
import { ErrorCode } from "./error-codes";

/** Section 6.4 error body. */
export interface ErrorBody {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  details?: Record<string, unknown>;
  requestId: string;
}

function toFieldErrors(error: ZodError): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.PAYLOAD_TOO_LARGE,
  415: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  428: ErrorCode.PRECONDITION_REQUIRED,
  429: ErrorCode.RATE_LIMITED,
  503: ErrorCode.SERVICE_UNAVAILABLE,
};

/**
 * Maps every error to the Section 6.4 body. Never returns stack traces, SQL or internal hostnames:
 * unexpected errors get a generic message and are logged with the request ID.
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
    void reply.status(status).send(body);
  }

  private map(exception: unknown, requestId: string): [number, ErrorBody] {
    if (exception instanceof AppError) {
      return [
        exception.status,
        {
          code: exception.code,
          message: exception.message,
          fieldErrors: exception.fieldErrors,
          details: exception.details,
          requestId,
        },
      ];
    }

    if (exception instanceof ZodValidationException) {
      return [
        HttpStatus.BAD_REQUEST,
        {
          code: ErrorCode.VALIDATION_FAILED,
          message: "Check the highlighted fields.",
          fieldErrors: toFieldErrors(exception.getZodError()),
          requestId,
        },
      ];
    }

    if (exception instanceof ThrottlerException) {
      return [
        HttpStatus.TOO_MANY_REQUESTS,
        {
          code: ErrorCode.RATE_LIMITED,
          message: "Too many requests. Wait a minute, then try again.",
          requestId,
        },
      ];
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2025") {
        return [
          HttpStatus.NOT_FOUND,
          { code: ErrorCode.NOT_FOUND, message: "Resource not found.", requestId },
        ];
      }
      if (exception.code === "P2002") {
        return [
          HttpStatus.CONFLICT,
          { code: ErrorCode.CONFLICT, message: "This conflicts with an existing record.", requestId },
        ];
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        STATUS_CODES[status] ?? (status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED);
      const message = status >= 500 ? "Something went wrong. Try again." : exception.message;
      return [status, { code, message, requestId }];
    }

    // Fastify's own errors (body too large, bad JSON, unsupported content type) carry a statusCode.
    const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const code = STATUS_CODES[statusCode] ?? ErrorCode.VALIDATION_FAILED;
      const message =
        statusCode === 413 ? "The request is too large." : "The request couldn't be read. Check the format.";
      return [statusCode, { code, message, requestId }];
    }

    return [
      HttpStatus.INTERNAL_SERVER_ERROR,
      { code: ErrorCode.INTERNAL_ERROR, message: "Something went wrong. Try again.", requestId },
    ];
  }
}
