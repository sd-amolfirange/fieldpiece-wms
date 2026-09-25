import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { Role, SessionUser } from "@wms/domain";
import { jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Actor } from "../../common/auth/context";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { type Db, PrismaService } from "../../infra/prisma/prisma.service";

// Sessions (api-contract "Authentication"):
// - POST /auth/login returns a short-lived access JWT in the body and sets a refresh cookie;
// - the cookie holds a random token; only its SHA-256 is stored, so a database leak doesn't leak sessions;
// - every request re-checks the session row, so signing out ends the access token too;
// - refreshing slides the session's expiry (idle timeout AUTH_SESSION_TTL_DAYS).

export const REFRESH_COOKIE = "wms_refresh";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const userInclude = { dealer: true, distributor: true, customer: true } satisfies Prisma.UserInclude;
type UserRow = Prisma.UserGetPayload<{ include: typeof userInclude }>;

@Injectable()
export class SessionService {
  private readonly key: Uint8Array;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.key = new TextEncoder().encode(env.AUTH_JWT_SECRET);
  }

  get cookieMaxAgeSeconds(): number {
    return this.env.AUTH_SESSION_TTL_DAYS * 86_400;
  }

  private expiry(now: Date): Date {
    return new Date(now.getTime() + this.cookieMaxAgeSeconds * 1000);
  }

  /** Starts a session and returns the refresh token for the cookie (never stored in clear). */
  async create(userId: string, now: Date, userAgent: string | undefined): Promise<{ id: string; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const id = randomUUID();
    await this.prisma.authSession.create({
      data: {
        id,
        userId,
        tokenHash: sha256(token),
        createdAt: now,
        lastUsedAt: now,
        expiresAt: this.expiry(now),
        userAgent: userAgent?.slice(0, 300),
      },
    });
    return { id, token };
  }

  /** Issued and expiry times come from the same clock the guard verifies with. */
  async accessToken(userId: string, sessionId: string, now: Date): Promise<string> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    return new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer(this.env.AUTH_JWT_ISSUER)
      .setAudience(this.env.AUTH_JWT_ISSUER)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.env.AUTH_ACCESS_TOKEN_TTL_SECONDS)
      .sign(this.key);
  }

  /** The caller behind a bearer token, or null when it's invalid, expired or its session has ended. */
  async actorFromAccessToken(token: string, now: Date): Promise<Actor | null> {
    let sub: string | undefined;
    let sid: unknown;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: this.env.AUTH_JWT_ISSUER,
        audience: this.env.AUTH_JWT_ISSUER,
        currentDate: now,
      });
      sub = payload.sub;
      sid = payload.sid;
    } catch {
      return null;
    }
    if (!sub || typeof sid !== "string") return null;
    const session = await this.prisma.authSession.findUnique({ where: { id: sid }, include: { user: true } });
    if (!session || session.userId !== sub || !this.isLive(session, now)) return null;
    return this.actor(this.prisma, session.user, session.id);
  }

  /** The caller behind a refresh cookie (file downloads and POST /auth/refresh). */
  async fromRefreshToken(
    token: string | undefined,
    now: Date,
  ): Promise<{ sessionId: string; user: UserRow } | null> {
    if (!token) return null;
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: { include: userInclude } },
    });
    if (!session || !this.isLive(session, now)) return null;
    return { sessionId: session.id, user: session.user };
  }

  async actorFromRefreshToken(token: string | undefined, now: Date): Promise<Actor | null> {
    const found = await this.fromRefreshToken(token, now);
    return found ? this.actor(this.prisma, found.user, found.sessionId) : null;
  }

  /** Slides the idle timeout. */
  async touch(sessionId: string, now: Date): Promise<void> {
    await this.prisma.authSession.update({
      where: { id: sessionId },
      data: { lastUsedAt: now, expiresAt: this.expiry(now) },
    });
  }

  async revoke(where: { token?: string; sessionId?: string }, now: Date): Promise<void> {
    const or: Prisma.AuthSessionWhereInput[] = [];
    if (where.token) or.push({ tokenHash: sha256(where.token) });
    if (where.sessionId) or.push({ id: where.sessionId });
    if (!or.length) return;
    await this.prisma.authSession.updateMany({ where: { OR: or, revokedAt: null }, data: { revokedAt: now } });
  }

  async findUserForLogin(email: string): Promise<UserRow | null> {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, include: userInclude });
  }

  async recordLogin(userId: string, now: Date): Promise<void> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: now } });
  }

  sessionUser(user: UserRow): SessionUser {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as Role,
      dealerId: user.dealerId ?? undefined,
      distributorId: user.distributorId ?? undefined,
      customerId: user.customerId ?? undefined,
      orgName: user.dealer?.name ?? user.distributor?.name ?? user.customer?.name,
      currency: this.env.APP_CURRENCY,
    };
  }

  private isLive(session: { revokedAt: Date | null; expiresAt: Date; user: { isActive: boolean } }, now: Date) {
    return !session.revokedAt && session.expiresAt > now && session.user.isActive;
  }

  private async actor(
    db: Db,
    user: Pick<UserRow, "id" | "name" | "email" | "role" | "dealerId" | "distributorId" | "customerId">,
    sessionId: string,
  ): Promise<Actor> {
    const role = user.role as Role;
    let visibleDealerIds: string[] | null;
    switch (role) {
      case "admin":
        visibleDealerIds = null;
        break;
      case "distributor":
        visibleDealerIds = (
          await db.dealer.findMany({ where: { distributorId: user.distributorId ?? "\u0000" }, select: { id: true } })
        ).map((d) => d.id);
        break;
      case "dealer":
        visibleDealerIds = user.dealerId ? [user.dealerId] : [];
        break;
      case "customer":
        visibleDealerIds = [];
        break;
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role,
      dealerId: user.dealerId ?? undefined,
      distributorId: user.distributorId ?? undefined,
      customerId: user.customerId ?? undefined,
      visibleDealerIds,
      sessionId,
    };
  }
}
