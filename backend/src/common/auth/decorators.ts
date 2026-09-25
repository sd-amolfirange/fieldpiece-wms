import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { AuthUser, RequestContext } from "./auth-user";
import type { Role } from "./roles";

export const IS_PUBLIC = "auth:isPublic";
export const ROLES = "auth:roles";

/**
 * Opts a route out of authentication. Every route is protected by default (Section 11.3);
 * `pnpm routes:public` lists every route that uses this, for review.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Layer 1 of authorisation (Section 7.2): which roles may call this route at all. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export type AuthenticatedRequest = FastifyRequest & { user?: AuthUser };

/** The authenticated caller plus IP and request ID, for services and audit rows. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) throw new Error("@Ctx() used on a route without authentication");
  return { user: request.user, ip: request.ip ?? null, requestId: String(request.id) };
});
