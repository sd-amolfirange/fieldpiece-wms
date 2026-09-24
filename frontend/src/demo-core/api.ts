import { todayIso, type Role, type User, type WarrantyStatus } from "../domain";
import { createSeed } from "./seed";
import {
  authenticate,
  claimCounts,
  dashboardSummary,
  getClaim,
  getComplaint,
  getRegistration,
  getUnit,
  listBrands,
  listClaims,
  listComplaints,
  listDealers,
  listIntegrations,
  listModels,
  listNotifications,
  listRegistrations,
  listUnits,
  markNotificationsRead,
  orgStructure,
  requireRole,
  ServiceError,
  toSessionUser,
  type Ctx,
  type ListQuery,
} from "./services";
import type { DemoState } from "./state";

// Transport-agnostic demo API. The Express server and the MSW handlers both call dispatch(), so the
// endpoints, scoping and error shapes are defined once. Paths are relative to the API base ("/api").

export interface DemoDb {
  state: DemoState;
  /** Called after every successful write (the server saves to disk). */
  onChange?: (state: DemoState) => void;
  /** Override "today" in tests. */
  today?: () => string;
}

export interface SessionStore {
  create(userId: string): string;
  get(token: string | undefined): string | undefined;
  delete(token: string | undefined): void;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, string>();
  return {
    create(userId) {
      const token = `${userId}.${crypto.randomUUID()}`;
      sessions.set(token, userId);
      return token;
    },
    get: (token) => (token ? sessions.get(token) : undefined),
    delete: (token) => void (token && sessions.delete(token)),
  };
}

export interface DemoRequest {
  method: string;
  /** Path after the API base, e.g. "/units/AER-SPL15-210311". */
  path: string;
  query: Record<string, string | undefined>;
  body?: unknown;
  /** Bearer access token. */
  accessToken?: string;
  /** Refresh session from the httpOnly cookie. */
  refreshToken?: string;
}

export interface DemoResponse {
  status: number;
  body?: unknown;
  /** Adapters turn these into Set-Cookie headers. */
  setRefreshToken?: string;
  clearRefreshToken?: boolean;
}

type Handler = (ctx: Ctx, params: Record<string, string>, req: DemoRequest) => unknown;

interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  roles?: Role[];
  handler: Handler;
}

const num = (v: string | undefined) => (v ? Number(v) || undefined : undefined);
const listQuery = (q: DemoRequest["query"]): ListQuery => ({
  page: num(q.page),
  pageSize: num(q.pageSize),
  sort: q.sort || undefined,
  q: q.q || undefined,
});
const opt = <T extends string>(v: string | undefined) => (v ? (v as T) : undefined);

export const routes: Route[] = [
  {
    method: "GET",
    path: "/units",
    handler: (ctx, _p, req) =>
      listUnits(ctx, {
        ...listQuery(req.query),
        status: opt<WarrantyStatus>(req.query.status),
        dealerId: opt(req.query.dealerId),
      }),
  },
  { method: "GET", path: "/units/:serial", handler: (ctx, p) => getUnit(ctx, p.serial ?? "") },
  {
    method: "GET",
    path: "/registrations",
    handler: (ctx, _p, req) =>
      listRegistrations(ctx, {
        ...listQuery(req.query),
        status: opt(req.query.status),
        channel: opt(req.query.channel),
        flag: opt(req.query.flag),
      }),
  },
  { method: "GET", path: "/registrations/:id", handler: (ctx, p) => getRegistration(ctx, p.id ?? "") },
  {
    method: "GET",
    path: "/complaints",
    handler: (ctx, _p, req) =>
      listComplaints(ctx, {
        ...listQuery(req.query),
        status: opt(req.query.status),
        source: opt(req.query.source),
      }),
  },
  { method: "GET", path: "/complaints/:id", handler: (ctx, p) => getComplaint(ctx, p.id ?? "") },
  {
    method: "GET",
    path: "/claims",
    roles: ["admin", "dealer", "distributor"],
    handler: (ctx, _p, req) =>
      listClaims(ctx, {
        ...listQuery(req.query),
        status: opt(req.query.status),
        brandId: opt(req.query.brandId),
      }),
  },
  {
    method: "GET",
    path: "/claims/counts",
    roles: ["admin", "dealer", "distributor"],
    handler: (ctx) => claimCounts(ctx),
  },
  {
    method: "GET",
    path: "/claims/:id",
    roles: ["admin", "dealer", "distributor"],
    handler: (ctx, p) => getClaim(ctx, p.id ?? ""),
  },
  { method: "GET", path: "/models", handler: (ctx) => listModels(ctx) },
  { method: "GET", path: "/brands", handler: (ctx) => listBrands(ctx) },
  {
    method: "GET",
    path: "/dealers",
    roles: ["admin", "dealer", "distributor"],
    handler: (ctx) => listDealers(ctx),
  },
  { method: "GET", path: "/admin/org", roles: ["admin"], handler: (ctx) => orgStructure(ctx) },
  {
    method: "GET",
    path: "/integrations",
    roles: ["admin"],
    handler: (ctx, _p, req) =>
      listIntegrations(ctx, {
        ...listQuery(req.query),
        system: req.query.system,
        direction: req.query.direction,
        status: req.query.status,
      }),
  },
  { method: "GET", path: "/dashboard/summary", handler: (ctx) => dashboardSummary(ctx) },
  { method: "GET", path: "/notifications", handler: (ctx) => listNotifications(ctx) },
  {
    method: "POST",
    path: "/notifications/read",
    handler: (ctx, _p, req) => {
      markNotificationsRead(ctx, (req.body as { ids?: string[] } | undefined)?.ids);
      return { ok: true };
    },
  },
];

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i += 1) {
    const seg = a[i] ?? "";
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i] ?? "");
    else if (seg !== b[i]) return null;
  }
  return params;
}

const errorResponse = (e: ServiceError): DemoResponse => ({
  status: e.status,
  body: { code: e.code, message: e.message, fieldErrors: e.fieldErrors },
});

export function contextFor(db: DemoDb, user: User): Ctx {
  const now = new Date();
  return { state: db.state, user, today: db.today?.() ?? todayIso(now), now: now.toISOString() };
}

export function userFromToken(
  db: DemoDb,
  sessions: SessionStore,
  token: string | undefined,
): User | undefined {
  const userId = sessions.get(token);
  return userId ? db.state.users.find((u) => u.id === userId) : undefined;
}

export function dispatch(db: DemoDb, sessions: SessionStore, req: DemoRequest): DemoResponse {
  const method = req.method.toUpperCase();
  try {
    // ---- auth (no access token needed) ----
    if (method === "POST" && req.path === "/auth/login") {
      const { email = "", password = "" } = (req.body ?? {}) as { email?: string; password?: string };
      const user = authenticate(db.state, email, password);
      const access = sessions.create(user.id);
      return {
        status: 200,
        body: { accessToken: access, user: toSessionUser(db.state, user) },
        setRefreshToken: sessions.create(user.id),
      };
    }
    if (method === "POST" && req.path === "/auth/refresh") {
      const user = userFromToken(db, sessions, req.refreshToken);
      if (!user) throw new ServiceError(401, "unauthenticated", "Session expired. Sign in again.");
      return {
        status: 200,
        body: { accessToken: sessions.create(user.id), user: toSessionUser(db.state, user) },
      };
    }
    if (method === "POST" && req.path === "/auth/logout") {
      sessions.delete(req.refreshToken);
      sessions.delete(req.accessToken);
      return { status: 204, clearRefreshToken: true };
    }

    const user = userFromToken(db, sessions, req.accessToken);
    if (!user) throw new ServiceError(401, "unauthenticated", "Session expired. Sign in again.");
    const ctx = contextFor(db, user);

    if (method === "POST" && req.path === "/simulate/reset") {
      requireRole(ctx, "admin");
      db.state = createSeed(ctx.today);
      db.onChange?.(db.state);
      return { status: 200, body: { ok: true } };
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, req.path);
      if (!params) continue;
      if (route.roles) requireRole(ctx, ...route.roles);
      const body = route.handler(ctx, params, req);
      if (method !== "GET") db.onChange?.(db.state);
      return { status: 200, body };
    }
    return { status: 404, body: { code: "not_found", message: "Not found." } };
  } catch (e) {
    if (e instanceof ServiceError) return errorResponse(e);
    throw e;
  }
}
