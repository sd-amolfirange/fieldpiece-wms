import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";
import { AuthUserResolver } from "./auth-user-resolver";
import { type AuthenticatedRequest, IS_PUBLIC, ROLES } from "./decorators";
import { JwtVerifier } from "./jwt-verifier.service";
import type { Role } from "./roles";

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

/**
 * Global guard: authentication on every route unless @Public(), then the @Roles() check.
 * Data scope (layer 2) is enforced in repositories, never here.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
    private readonly resolver: AuthUserResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = bearerToken(request.headers.authorization);
    if (!token)
      throw new AppError(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, "Sign in to continue.");

    let user;
    try {
      user = await this.resolver.resolve(await this.verifier.verify(token));
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        "Your session has expired. Sign in again.",
      );
    }
    if (!user.isActive) throw AppError.forbidden("This account is disabled. Contact your administrator.");
    request.user = user;
    (request.raw as { userId?: string }).userId = user.id; // for the request log line

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !user.hasAny(...roles)) throw AppError.forbidden();
    return true;
  }
}
