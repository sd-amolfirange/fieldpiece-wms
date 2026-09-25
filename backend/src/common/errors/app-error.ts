import { HttpStatus } from "@nestjs/common";
import { ErrorCode } from "./error-codes";

export type FieldErrors = Record<string, string[]>;

/**
 * Expected business failure (Section 15). Services throw this; the global filter maps it to the
 * Section 6.4 error body. Never throw a bare Error for an expected failure.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly fieldErrors?: FieldErrors,
    /** Extra, safe-to-expose details (e.g. whether the caller owns a duplicate registration). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }

  static notFound(what = "Resource"): AppError {
    return new AppError(ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, `${what} not found.`);
  }

  static forbidden(message = "You don't have access to this."): AppError {
    return new AppError(ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN, message);
  }

  static unprocessable(code: ErrorCode, message: string, fieldErrors?: FieldErrors): AppError {
    return new AppError(code, HttpStatus.UNPROCESSABLE_ENTITY, message, fieldErrors);
  }

  static conflict(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(code, HttpStatus.CONFLICT, message, undefined, details);
  }

  static staleVersion(): AppError {
    return new AppError(
      ErrorCode.STALE_VERSION,
      HttpStatus.CONFLICT,
      "Someone else changed this record. Reload it and try again.",
    );
  }
}
