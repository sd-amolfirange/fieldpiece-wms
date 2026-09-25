import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Role } from "@wms/domain";
import type { Actor } from "../../common/auth/context";
import { type AuthenticatedRequest, COOKIE_AUTH, IS_PUBLIC, ROLES } from "../../common/auth/decorators";
import { AppError } from "../../common/errors/app-error";
import { isoDateIn } from "../../common/time/business-date";
import { Clock } from "../../common/time/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { REFRESH_COOKIE, SessionService } from "./session.service";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Global guard: every route needs a signed-in user unless it's @Public(); then the @Roles() check. Sets the request
 * context (caller, today, now) that controllers pass to services.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const now = this.clock.now();

    let actor: Actor | null = null;
    const bearer = bearerToken(request.headers.authorization);
    if (bearer) actor = await this.sessions.actorFromAccessToken(bearer, now);
    // <img src>, <object data> and download links can't send a bearer token: accept the session cookie there.
    if (!actor && this.reflector.getAllAndOverride<boolean>(COOKIE_AUTH, targets)) {
      actor = await this.sessions.actorFromRefreshToken(request.cookies?.[REFRESH_COOKIE], now);
    }
    if (!actor) throw AppError.unauthenticated();

    request.ctx = { user: actor, now, today: isoDateIn(this.env.APP_TIMEZONE, now), requestId: String(request.id) };
    (request as unknown as { user: { id: string } }).user = { id: actor.id }; // rate-limit tracker
    (request.raw as { userId?: string }).userId = actor.id; // request log line

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(actor.role)) throw AppError.forbidden();
    return true;
  }
}
