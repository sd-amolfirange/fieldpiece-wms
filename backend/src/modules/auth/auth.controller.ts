import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import {
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import type { SessionUser } from "@wms/domain";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../common/auth/decorators";
import { AppError } from "../../common/errors/app-error";
import { SignInRateLimit } from "../../common/http/throttling";
import { Clock } from "../../common/time/clock";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { dummyPasswordHash, verifyPassword } from "./password";
import { REFRESH_COOKIE, SessionService } from "./session.service";

interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

const invalidCredentials = () =>
  new AppError(401, "invalid_credentials", "Email or password is wrong. Check them and try again.");

const str = (v: unknown) => (typeof v === "string" ? v : "");

@ApiTags("auth")
@Public()
@Controller("auth")
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setCookie(request: FastifyRequest, reply: FastifyReply, token: string) {
    void reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.protocol === "https",
      path: `/${this.env.API_PREFIX}`,
      maxAge: this.sessions.cookieMaxAgeSeconds,
    });
  }

  @Post("login")
  @HttpCode(200)
  @SignInRateLimit()
  @ApiOperation({
    summary: "Sign in",
    description:
      "Checks email and password. Returns a short-lived access token (send it as `Authorization: Bearer`) and " +
      "sets the httpOnly `wms_refresh` cookie for POST /auth/refresh.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: { email: { type: "string", format: "email" }, password: { type: "string" } },
    },
  })
  @ApiOkResponse({ description: "`{ accessToken, user: SessionUser }`" })
  @ApiUnauthorizedResponse({ description: "`invalid_credentials`" })
  @ApiTooManyRequestsResponse({ description: "`rate_limited`" })
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const { email, password } = (body ?? {}) as Record<string, unknown>;
    const now = this.clock.now();
    const user = await this.sessions.findUserForLogin(str(email));
    // Same work whether or not the account exists, so response times don't reveal valid emails.
    const ok = await verifyPassword(str(password), user?.passwordHash ?? (await dummyPasswordHash()));
    if (!user || !user.passwordHash || !user.isActive || !ok) throw invalidCredentials();

    const session = await this.sessions.create(user.id, now, request.headers["user-agent"]);
    await this.sessions.recordLogin(user.id, now);
    this.setCookie(request, reply, session.token);
    return {
      accessToken: await this.sessions.accessToken(user.id, session.id, now),
      user: this.sessions.sessionUser(user),
    };
  }

  @Post("refresh")
  @HttpCode(200)
  @ApiOperation({
    summary: "New access token from the refresh cookie",
    description: "Reads `wms_refresh`, extends the session and returns a fresh access token.",
  })
  @ApiOkResponse({ description: "`{ accessToken, user: SessionUser }`" })
  @ApiUnauthorizedResponse({ description: "`unauthenticated`: the session ended or expired" })
  async refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const now = this.clock.now();
    const token = request.cookies?.[REFRESH_COOKIE];
    const found = await this.sessions.fromRefreshToken(token, now);
    if (!found || !token) throw AppError.unauthenticated();
    await this.sessions.touch(found.sessionId, now);
    this.setCookie(request, reply, token); // extends the cookie's lifetime too
    return {
      accessToken: await this.sessions.accessToken(found.user.id, found.sessionId, now),
      user: this.sessions.sessionUser(found.user),
    };
  }

  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ summary: "Sign out", description: "Ends the session (refresh cookie and access token)." })
  @ApiNoContentResponse({ description: "Signed out" })
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const now = this.clock.now();
    const bearer = request.headers.authorization?.replace(/^Bearer /i, "");
    const fromBearer = bearer ? await this.sessions.actorFromAccessToken(bearer, now) : null;
    await this.sessions.revoke({ token: request.cookies?.[REFRESH_COOKIE], sessionId: fromBearer?.sessionId }, now);
    void reply.clearCookie(REFRESH_COOKIE, { path: `/${this.env.API_PREFIX}` });
  }
}
