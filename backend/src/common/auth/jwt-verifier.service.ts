import { Inject, Injectable } from "@nestjs/common";
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DevIdpKeys } from "./dev-idp-keys";

export interface VerifiedToken extends JWTPayload {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Validates access tokens (Section 7.1): signature against the JWKS (cached, kid rotation handled by jose),
 * iss, aud, exp / nbf with 60 s skew, and only RS256 / ES256. Never `none`, never HS256.
 */
@Injectable()
export class JwtVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    @Inject(ENV) private readonly env: Env,
    devIdp: DevIdpKeys,
  ) {
    this.keys = env.DEV_IDP_ENABLED
      ? // Same verification path as production; only the key source is in-process.
        (header, token) => createLocalJWKSet(devIdp.publicJwks())(header, token)
      : createRemoteJWKSet(new URL(env.OIDC_JWKS_URI), { cacheMaxAge: 3_600_000, cooldownDuration: 30_000 });
  }

  async verify(token: string): Promise<VerifiedToken> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.env.OIDC_ISSUER,
      audience: this.env.OIDC_AUDIENCE,
      algorithms: ["RS256", "ES256"],
      clockTolerance: 60,
      requiredClaims: ["sub", "exp"],
    });
    return payload as VerifiedToken;
  }
}
