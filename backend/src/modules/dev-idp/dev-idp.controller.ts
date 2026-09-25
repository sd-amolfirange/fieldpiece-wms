import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import { jwtVerify, SignJWT } from "jose";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { Public } from "../../common/auth/decorators";
import { DevIdpKeys } from "../../common/auth/dev-idp-keys";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { UsersService } from "../users";

// DEVELOPMENT-ONLY identity provider. Stands in for the real OIDC provider [CONFIRM] so the full auth path
// (RS256 JWT -> JWKS -> guard -> DB roles) runs locally. Mounted only when DEV_IDP_ENABLED, which the env
// schema forbids in production. There are no passwords: pick a seeded test identity.
//
// The refresh token lives in an httpOnly cookie scoped to /dev-idp: the IdP's session, not the API's.
// The API itself stays cookie-free (Section 7.1).

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 8 * 60 * 60;
const COOKIE = "wms_dev_idp_rt";
const REFRESH_AUDIENCE = "dev-idp-refresh";

class TokenRequestDto extends createZodDto(z.object({ email: z.string().email() })) {}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

@ApiExcludeController()
@Public()
@Controller("dev-idp")
export class DevIdpController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly keys: DevIdpKeys,
    private readonly users: UsersService,
  ) {}

  @Get(".well-known/openid-configuration")
  discovery() {
    return {
      issuer: this.env.OIDC_ISSUER,
      jwks_uri: this.env.OIDC_JWKS_URI,
      token_endpoint: `${this.env.OIDC_ISSUER}/token`,
      id_token_signing_alg_values_supported: [this.keys.alg],
    };
  }

  @Get(".well-known/jwks.json")
  jwks() {
    return this.keys.publicJwks();
  }

  /** Test identities for the sign-in picker. */
  @Get("users")
  identities() {
    return this.users.listDevIdentities();
  }

  @Post("token")
  @HttpCode(HttpStatus.OK)
  async token(@Body() body: TokenRequestDto, @Res({ passthrough: true }) reply: FastifyReply) {
    const user = await this.users.findByEmail(body.email);
    if (!user?.isActive || !user.idpSubject.startsWith("dev|")) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, "Unknown test identity.");
    }
    const refresh = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: this.keys.alg, kid: this.keys.kid })
      .setSubject(user.idpSubject)
      .setIssuer(this.env.OIDC_ISSUER)
      .setAudience(REFRESH_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${REFRESH_TTL_SECONDS}s`)
      .sign(this.keys.signingKey());
    void reply.header(
      "Set-Cookie",
      `${COOKIE}=${refresh}; Path=/dev-idp; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_TTL_SECONDS}`,
    );
    return this.issue(user.idpSubject, user.email, user.displayName);
  }

  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: FastifyRequest) {
    const cookie = readCookie(request, COOKIE);
    if (!cookie) throw new AppError(ErrorCode.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, "No session.");
    try {
      const { payload } = await jwtVerify(cookie, this.keys.signingKey(), {
        issuer: this.env.OIDC_ISSUER,
        audience: REFRESH_AUDIENCE,
        algorithms: [this.keys.alg],
      });
      const user = await this.users.findByEmail(String(payload.email));
      if (!user?.isActive || user.idpSubject !== payload.sub) throw new Error("identity changed");
      return this.issue(user.idpSubject, user.email, user.displayName);
    } catch {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        "Session expired. Sign in again.",
      );
    }
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Res({ passthrough: true }) reply: FastifyReply): void {
    void reply.header("Set-Cookie", `${COOKIE}=; Path=/dev-idp; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  private async issue(sub: string, email: string, name: string) {
    const accessToken = await new SignJWT({ email, email_verified: true, name })
      .setProtectedHeader({ alg: this.keys.alg, kid: this.keys.kid })
      .setSubject(sub)
      .setIssuer(this.env.OIDC_ISSUER)
      .setAudience(this.env.OIDC_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.keys.signingKey());
    return { accessToken, tokenType: "Bearer", expiresIn: ACCESS_TTL_SECONDS };
  }
}
