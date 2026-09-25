import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ErrorCode } from "../errors/error-codes";

// Swagger helpers (Section 6.6): every endpoint documents every error it can return.

export const errorResponseSchema = z.object({
  code: z.nativeEnum(ErrorCode).describe("Stable machine-readable code; map it to a message in the UI"),
  message: z.string().describe("Human-readable message, safe to show"),
  fieldErrors: z.record(z.array(z.string())).optional().describe("Per-field validation messages"),
  details: z.record(z.unknown()).optional(),
  requestId: z.string().describe("Correlates with logs and the X-Request-Id header"),
});

export class ErrorResponseDto extends createZodDto(errorResponseSchema) {}

const STATUS_TEXT: Record<number, string> = {
  400: "Validation failed",
  401: "Missing or invalid token",
  403: "Not allowed",
  404: "Not found, or not in your scope",
  409: "Conflict",
  413: "Payload too large",
  422: "Business rule broken",
  428: "If-Match header required",
  429: "Rate limited",
};

type ErrorSpec = Partial<Record<number, readonly ErrorCode[]>>;

/**
 * Documents error responses. 400 / 401 / 429 are added automatically for authenticated routes.
 * Usage: @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 409: [ErrorCode.STALE_VERSION] })
 */
export function ApiErrors(spec: ErrorSpec = {}, { isPublic = false } = {}) {
  const merged: ErrorSpec = {
    400: [ErrorCode.VALIDATION_FAILED],
    429: [ErrorCode.RATE_LIMITED],
    ...(isPublic ? {} : { 401: [ErrorCode.UNAUTHENTICATED], 403: [ErrorCode.FORBIDDEN] }),
    ...spec,
  };
  return applyDecorators(
    ...Object.entries(merged).map(([status, codes]) =>
      ApiResponse({
        status: Number(status),
        description: `${STATUS_TEXT[Number(status)] ?? "Error"}: ${(codes ?? []).join(", ")}`,
        type: ErrorResponseDto,
      }),
    ),
  );
}
