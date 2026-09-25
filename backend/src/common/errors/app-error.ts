// Expected failures, in the error body the frontend reads (frontend/docs/api-contract.md, "Errors"):
//   { code, message, fieldErrors?, requestId }
// `code` is a stable lowercase machine code; `fieldErrors` values are i18n keys the frontend shows under the field.
// Services throw AppError; the global filter serialises it. Never throw a bare Error for an expected failure.

/** Every code the API returns. The frontend has behaviour or text for these. */
export const ERROR_CODES = [
  "unauthenticated",
  "invalid_credentials",
  "forbidden",
  "not_found",
  "validation_error",
  "bad_request",
  "rate_limited",
  "server_error",
  // files
  "too_large",
  "unsupported_type",
  "upload_failed",
  "invalid_attachment",
  "empty_file",
  // registrations
  "duplicate_serial",
  "not_pending",
  "unknown_model",
  "nothing_to_merge",
  // units
  "already_void",
  "not_registered",
  // complaints and service
  "already_sent",
  "not_with_service",
  "no_such_part",
  // claims and integrations
  "invalid_transition",
  "not_failed",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Field name -> i18n key (e.g. `{ purchaseDate: "validation.date" }`). */
export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "AppError";
  }

  static unauthenticated(message = "Session expired. Sign in again."): AppError {
    return new AppError(401, "unauthenticated", message);
  }

  static forbidden(message = "You don't have access to this."): AppError {
    return new AppError(403, "forbidden", message);
  }

  /** Also used for rows outside the caller's scope, so ids can't be probed. */
  static notFound(what: string): AppError {
    return new AppError(404, "not_found", `${what} not found.`);
  }

  static validation(message: string, fieldErrors?: FieldErrors): AppError {
    return new AppError(422, "validation_error", message, fieldErrors);
  }

  static conflict(code: ErrorCode, message: string, fieldErrors?: FieldErrors): AppError {
    return new AppError(409, code, message, fieldErrors);
  }
}
