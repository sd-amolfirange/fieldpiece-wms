// Expected failures, in the error body the frontend reads: { code, message, fieldErrors?, requestId }.
// Same codes and statuses as the real backend (backend/src/common/errors/app-error.ts).

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthenticated = (message = "Session expired. Sign in again.") =>
  new ServiceError(401, "unauthenticated", message);

export const forbidden = () => new ServiceError(403, "forbidden", "You don't have access to this.");

/** Also used for rows outside the caller's scope, so ids can't be probed. */
export const notFound = (what: string) => new ServiceError(404, "not_found", `${what} not found.`);

export const validation = (message: string, fieldErrors?: Record<string, string>) =>
  new ServiceError(422, "validation_error", message, fieldErrors);

export const conflict = (code: string, message: string, fieldErrors?: Record<string, string>) =>
  new ServiceError(409, code, message, fieldErrors);

/** Throws a 422 with the collected field errors, if there are any. */
export function throwIfErrors(errors: Record<string, string>, message = "Check the highlighted fields.") {
  if (Object.keys(errors).length) throw validation(message, errors);
}
