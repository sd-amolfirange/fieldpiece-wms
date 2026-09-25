import { createParamDecorator, type ExecutionContext, HttpStatus } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";

// Optimistic locking (Section 6.5): GET returns ETag: W/"<version>", mutations send If-Match.

export const etagFor = (version: number) => `W/"${version}"`;

export function setEtag(reply: FastifyReply, version: number): void {
  void reply.header("ETag", etagFor(version));
}

export function parseIfMatch(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    throw new AppError(
      ErrorCode.PRECONDITION_REQUIRED,
      HttpStatus.PRECONDITION_REQUIRED,
      "This change needs an If-Match header with the version you loaded.",
    );
  }
  const match = /^(?:W\/)?"(\d+)"$/.exec(value.trim());
  if (!match) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, 'If-Match must look like W/"3".');
  }
  return Number(match[1]);
}

/** The version the client last saw, from a required If-Match header. */
export const IfMatch = createParamDecorator((_: unknown, ctx: ExecutionContext): number =>
  parseIfMatch(ctx.switchToHttp().getRequest<FastifyRequest>().headers["if-match"]),
);
