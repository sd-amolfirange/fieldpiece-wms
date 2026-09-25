import { HttpStatus, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthUser, type RequestContext } from "../../common/auth/auth-user";
import { AuthUserResolver } from "../../common/auth/auth-user-resolver";
import type { VerifiedToken } from "../../common/auth/jwt-verifier.service";
import { isRole, type Role } from "../../common/auth/roles";
import { AppError } from "../../common/errors/app-error";
import { ErrorCode } from "../../common/errors/error-codes";
import { orderByFrom, pageArgs, type Paginated } from "../../common/pagination/pagination";
import { CacheService } from "../../infra/redis/cache.service";
import { PrismaService } from "../../infra/prisma/prisma.service";
import { AuditService } from "../audit";
import type { MeDto, UserListQueryDto, UserResponse } from "./dto";
import { permissionsFor } from "./permissions";
import { type UserWithOrg, UsersRepository } from "./users.repository";

const ME_TTL_SECONDS = 60; // Section 9.3
const meKey = (idpSubject: string) => `me:${idpSubject}`;

/** Users pre-provisioned by an admin get this placeholder subject until their first sign-in. */
const PENDING_PREFIX = "pending:";

/** Role for self-registered IdP users with no row yet. [CONFIRM] onboarding rules with Fieldpiece. */
const DEFAULT_ROLES: Role[] = ["technician"];

interface CachedUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  organizationId: string | null;
  currency: string;
  isActive: boolean;
}

function toAuthUser(u: CachedUser): AuthUser {
  return new AuthUser(
    u.id,
    u.email,
    u.displayName,
    u.roles.filter(isRole),
    u.organizationId,
    u.currency,
    u.isActive,
  );
}

function toCached(u: UserWithOrg): CachedUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles,
    organizationId: u.organizationId,
    currency: u.organization?.currency ?? "USD",
    isActive: u.isActive,
  };
}

export function toUserResponse(u: UserWithOrg): UserResponse {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    roles: u.roles.filter(isRole),
    organizationId: u.organizationId,
    organizationName: u.organization?.name ?? null,
    isActive: u.isActive,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService extends AuthUserResolver {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: UsersRepository,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
  ) {
    super();
  }

  /** Upserts the user by `sub` on first request (Section 7.1). Cached for 60 s. */
  async resolve(token: VerifiedToken): Promise<AuthUser> {
    const cached = await this.cache.get<CachedUser>(meKey(token.sub));
    if (cached) return toAuthUser(cached);

    const user = await this.findOrProvision(token);
    await this.cache.set(meKey(token.sub), toCached(user), ME_TTL_SECONDS);
    return toAuthUser(toCached(user));
  }

  private async findOrProvision(token: VerifiedToken): Promise<UserWithOrg> {
    const existing = await this.repo.findBySubject(this.prisma, token.sub);
    if (existing) return this.repo.update(this.prisma, existing.id, { lastLoginAt: new Date() });

    const email = token.email?.toLowerCase();
    if (!email || token.email_verified === false) {
      throw new AppError(
        ErrorCode.UNAUTHENTICATED,
        HttpStatus.UNAUTHORIZED,
        "Your account needs a verified email.",
      );
    }

    // Bind an admin-provisioned account on first sign-in (verified email only).
    const byEmail = await this.repo.findByEmail(this.prisma, email);
    if (byEmail?.idpSubject.startsWith(PENDING_PREFIX)) {
      return this.repo.update(this.prisma, byEmail.id, { idpSubject: token.sub, lastLoginAt: new Date() });
    }
    if (byEmail) {
      // Same email, different subject: never silently merge identities.
      this.logger.warn({ userId: byEmail.id }, "Sign-in with a known email but unknown subject");
      throw AppError.forbidden("This email is linked to another sign-in. Contact your administrator.");
    }

    return this.repo.create(this.prisma, {
      idpSubject: token.sub,
      email,
      displayName: token.name ?? email,
      roles: DEFAULT_ROLES,
      lastLoginAt: new Date(),
    });
  }

  async me(user: AuthUser): Promise<MeDto> {
    const row = await this.repo.findById(this.prisma, user.id);
    if (!row) throw AppError.notFound("User");
    const roles = row.roles.filter(isRole);
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      roles,
      primaryRole: user.primaryRole,
      organization: row.organization
        ? {
            id: row.organization.id,
            name: row.organization.name,
            type: row.organization.type as "fieldpiece" | "distributor" | "service_center",
          }
        : null,
      currency: row.organization?.currency ?? "USD",
      permissions: permissionsFor(roles),
    };
  }

  /** For the dev IdP's sign-in picker and token endpoint. */
  findByEmail(email: string): Promise<UserWithOrg | null> {
    return this.repo.findByEmail(this.prisma, email.toLowerCase());
  }

  listDevIdentities() {
    return this.prisma.user.findMany({
      where: { isActive: true, idpSubject: { startsWith: "dev|" } },
      select: { email: true, displayName: true, roles: true },
      orderBy: { email: "asc" },
    });
  }

  async list(query: UserListQueryDto): Promise<Paginated<UserResponse>> {
    const where: Prisma.UserWhereInput = {
      roles: query.role ? { has: query.role } : undefined,
      isActive: query.active === undefined ? undefined : query.active === "true",
      OR: query.q
        ? [
            { email: { contains: query.q, mode: "insensitive" } },
            { displayName: { contains: query.q, mode: "insensitive" } },
          ]
        : undefined,
    };
    const orderBy = orderByFrom<Prisma.UserOrderByWithRelationInput>(
      query.sort,
      {
        email: (dir) => ({ email: dir }),
        displayName: (dir) => ({ displayName: dir }),
        createdAt: (dir) => ({ createdAt: dir }),
        lastLoginAt: (dir) => ({ lastLoginAt: { sort: dir, nulls: "last" } }),
      },
      "email",
    );
    const { skip, take } = pageArgs(query);
    const { items, total } = await this.repo.list(this.prisma, where, skip, take, orderBy);
    return { items: items.map(toUserResponse), page: query.page, pageSize: query.pageSize, total };
  }

  async get(id: string): Promise<UserResponse> {
    const row = await this.repo.findById(this.prisma, id);
    if (!row) throw AppError.notFound("User");
    return toUserResponse(row);
  }

  /** Pre-provisions a user; they're bound to their IdP identity on first sign-in with this email. */
  async create(
    ctx: RequestContext,
    input: { email: string; displayName: string; roles: Role[]; organizationId?: string | null },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await this.repo.create(tx, {
          idpSubject: `${PENDING_PREFIX}${input.email}`,
          email: input.email,
          displayName: input.displayName,
          roles: input.roles,
          organizationId: input.organizationId ?? null,
        });
        await this.audit.record(tx, ctx, {
          action: "user.created",
          entity: "user",
          entityId: created.id,
          after: { roles: input.roles, organizationId: input.organizationId ?? null },
        });
        return toUserResponse(created);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw AppError.conflict(ErrorCode.CONFLICT, "A user with this email already exists.");
      }
      throw err;
    }
  }

  async update(
    ctx: RequestContext,
    id: string,
    patch: { displayName?: string; roles?: Role[]; organizationId?: string | null; isActive?: boolean },
  ): Promise<UserResponse> {
    if (id === ctx.user.id && (patch.isActive === false || (patch.roles && !patch.roles.includes("admin")))) {
      throw AppError.unprocessable(ErrorCode.VALIDATION_FAILED, "You can't remove your own admin access.");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const before = await this.repo.findById(tx, id);
      if (!before) throw AppError.notFound("User");
      const after = await this.repo.update(tx, id, patch);
      const rolesChanged = patch.roles && patch.roles.join() !== before.roles.join();
      await this.audit.record(tx, ctx, {
        action: rolesChanged
          ? "user.roles_changed"
          : patch.isActive === false
            ? "user.deactivated"
            : "user.updated",
        entity: "user",
        entityId: id,
        before: { roles: before.roles, organizationId: before.organizationId, isActive: before.isActive },
        after: { roles: after.roles, organizationId: after.organizationId, isActive: after.isActive },
      });
      return after;
    });
    await this.cache.del(meKey(updated.idpSubject)); // role changes apply within one request, not 60 s
    return toUserResponse(updated);
  }
}
