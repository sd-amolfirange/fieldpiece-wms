import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Role } from "@wms/domain";
import type { FastifyRequest } from "fastify";
import type { Ctx as RequestCtx } from "./context";

export const IS_PUBLIC = "auth:isPublic";
export const ROLES = "auth:roles";
export const COOKIE_AUTH = "auth:cookie";

/**
 * Opts a route out of authentication. Every other route needs a signed-in user (deny by default);
 * `npm run routes:public` lists every route that uses this, for review.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Which roles may call the route at all. Data scope is applied in the services, never here. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/**
 * Also accepts the refresh-session cookie instead of a bearer token. Only for GETs that browsers load without
 * JavaScript (`<img src>`, `<object data>`, plain download links), which can't send an Authorization header.
 */
export const CookieAuth = () => SetMetadata(COOKIE_AUTH, true);

export type AuthenticatedRequest = FastifyRequest & { ctx?: RequestCtx };

/** The request context (caller, today, now) set by the auth guard. */
export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestCtx => {
  const request = host.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.ctx) throw new Error("@Ctx() used on a route without authentication");
  return request.ctx;
});
