import type { AuthUser } from "./auth-user";
import type { VerifiedToken } from "./jwt-verifier.service";

/**
 * Port the auth guard uses to turn a verified token into an AuthUser. Implemented by the users module
 * (upsert by idp_subject on first request, Section 7.1), so common/ never imports a module.
 */
export abstract class AuthUserResolver {
  abstract resolve(token: VerifiedToken): Promise<AuthUser>;
}
