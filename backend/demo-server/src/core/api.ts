import { todayIso, type Role, type UnitView, type User } from "@wms/domain";
import { templateCsv, rowsFromMatrix } from "./bulk-parse";
import { claimTransition, createClaim, getClaim, listClaims } from "./claims";
import { notFound, ServiceError, unauthenticated, validation } from "./errors";
import {
  assertInboundSecret,
  authenticatePartner,
  createPartnerClient,
  inboundEmail,
  intakeInfo,
  listPartnerClients,
  partnerRegistrations,
  publicFields,
  publicRegistration,
  setPartnerActive,
} from "./intake";
import { simplePdf } from "./pdf";
import {
  approveRegistration,
  BULK_IMPORT_MAX_BYTES,
  bulkApproveRegistrations,
  createBulkImport,
  createRegistration,
  getBulkImport,
  getRegistration,
  listBulkImports,
  listRegistrations,
  mergeRegistration,
  rejectRegistration,
  resubmitBulkRows,
} from "./registrations";
import { createSeed, DEMO_ACCOUNTS, DEMO_PASSWORD } from "./seed";
import {
  addAttachment,
  authenticate,
  certificateUnit,
  claimCounts,
  dashboardSummary,
  getAttachment,
  getUnit,
  listCategories,
  listDealers,
  listIntegrations,
  listModels,
  listNotifications,
  listUnits,
  markNotificationsRead,
  orgStructure,
  requireRole,
  retryIntegration,
  extendWarranty,
  financeSummary,
  toSessionUser,
  transaction,
  unitCoverage,
  unitExtensionQuote,
  updateModel,
  voidWarranty,
  type Ctx,
  type DemoFile,
  type DemoFileData,
  type FileStore,
  type RawQuery,
  type SystemCtx,
} from "./services";
import {
  simulateErpInvoice,
  simulateJoblinkRegistration,
  simulateMarketplaceOrder,
  simulateOverwatchRegistration,
  simulateRegistrationEmail,
} from "./simulate";
import type { DemoState } from "./state";

// Transport-agnostic mock of the real backend's API (backend/src): same routes, bodies, response shapes, status codes,
// error codes and scoping. The Express server and the frontend's MSW handlers both call dispatch(), so the endpoints
// are defined once. Paths are relative to the API base ("/api").

export interface DemoDb {
  state: DemoState;
  /** Called after every successful write (the server saves to disk). */
  onChange?: (state: DemoState) => void;
  /** "Today" (yyyy-MM-dd). Defaults to the local calendar date; the server passes the business time zone's. */
  today?: () => string;
  /** Where uploaded bytes are kept. Defaults to memory. */
  files?: Pick<FileStore, "save" | "load">;
  /** Attachment.url for a file id. Defaults to "/api/files/<id>". */
  fileUrl?: (id: string) => string;
  /** Shared secret of the inbound email webhook. Unset = email intake is off (404), as in the backend. */
  inboundEmailSecret?: string;
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
  /** Path after the API base, e.g. "/units/SC680-251406233". */
  path: string;
  query: RawQuery;
  /** JSON body, or the text fields of a multipart form. */
  body?: unknown;
  /** Request headers with lower-case names (x-api-key, x-inbound-secret). */
  headers?: Record<string, string | undefined>;
  /** The multipart `file` part. */
  file?: DemoFile;
  /** POST /bulk-imports: the uploaded sheet read into a string matrix by the adapter; null when it couldn't be read. */
  sheet?: string[][] | null;
  /** Bearer access token. */
  accessToken?: string;
  /** Refresh session from the httpOnly cookie (also accepted on file routes, as the backend does). */
  refreshToken?: string;
}

/** A file answer (downloads, certificate, templates). */
export interface DemoDownload {
  name: string;
  mime: string;
  disposition: "inline" | "attachment";
  data: DemoFileData;
}

export interface DemoResponse {
  status: number;
  body?: unknown;
  download?: DemoDownload;
  /** Adapters turn these into Set-Cookie headers. */
  setRefreshToken?: string;
  clearRefreshToken?: boolean;
}

class Download {
  constructor(readonly file: DemoDownload) {}
}

type Params = Record<string, string>;

type Route =
  | {
      method: "GET" | "POST" | "PUT" | "PATCH";
      path: string;
      public: true;
      status?: number;
      handler: (sys: SystemCtx, params: Params, req: DemoRequest, db: DemoDb) => unknown;
    }
  | {
      method: "GET" | "POST" | "PUT" | "PATCH";
      path: string;
      public?: false;
      roles?: Role[];
      /** Also accepts the session cookie (for <img src> and plain links), like the backend's file routes. */
      cookie?: boolean;
      status?: number;
      handler: (ctx: Ctx, params: Params, req: DemoRequest) => unknown;
    };

/** The certificate's extended-warranty line, when the warranty was extended. */
function extendedWarrantyLine(unit: UnitView): [string, string][] {
  const months = (unit.extensions ?? []).reduce((n, e) => n + e.months, 0);
  return months ? [["Extended warranty", `+${months} months (to ${unit.warrantyEnd ?? "-"})`]] : [];
}

const ALL: Role[] = ["admin", "dealer", "distributor", "customer"];
const STAFF: Role[] = ["admin", "dealer", "distributor"];
const ADMIN: Role[] = ["admin"];

const body = (req: DemoRequest) =>
  (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
const field = (req: DemoRequest, name: string) => {
  const value = body(req)[name];
  return typeof value === "string" ? value : undefined;
};

export const routes: Route[] = [
  // ---- public ----
  { method: "GET", path: "/health/live", public: true, handler: () => ({ status: "ok" }) },
  {
    method: "GET",
    path: "/auth/demo-accounts",
    public: true,
    // Fills the sign-in page's "Sign in as" picker.
    handler: () => DEMO_ACCOUNTS.map((a) => ({ ...a, password: DEMO_PASSWORD })),
  },
  { method: "GET", path: "/public/models", public: true, handler: (sys) => listModels(sys.state) },
  {
    method: "POST",
    path: "/public/registrations",
    public: true,
    handler: (sys, _p, req) => publicRegistration(sys, publicFields(req.body), req.file),
  },
  {
    method: "POST",
    path: "/partner/v1/registrations",
    public: true,
    handler: (sys, _p, req) =>
      partnerRegistrations(sys, authenticatePartner(sys, req.headers?.["x-api-key"]), req.body),
  },
  {
    method: "POST",
    path: "/inbound/email",
    public: true,
    status: 202,
    handler: (sys, _p, req, db) => {
      assertInboundSecret(db.inboundEmailSecret, req.headers?.["x-inbound-secret"]);
      return inboundEmail(sys, body(req));
    },
  },

  // ---- products ----
  { method: "GET", path: "/units", roles: ALL, handler: (ctx, _p, req) => listUnits(ctx, req.query) },
  { method: "GET", path: "/units/:serial", roles: ALL, handler: (ctx, p) => getUnit(ctx, p.serial ?? "") },
  {
    method: "GET",
    path: "/units/:serial/certificate.pdf",
    roles: ALL,
    cookie: true,
    handler: (ctx, p) => {
      const unit = certificateUnit(ctx, p.serial ?? "");
      // A simple placeholder document; the backend draws a fuller certificate with the same facts.
      return new Download({
        name: `warranty-${unit.serial}.pdf`,
        mime: "application/pdf",
        disposition: "attachment",
        data: simplePdf("Warranty certificate", [
          ["Product", `Fieldpiece ${unit.modelCode}, ${unit.modelName}`],
          ["Serial number", unit.serial],
          ["Batch number", unit.batchNumber ?? "-"],
          ["Owner", unit.customerName ?? "-"],
          ["Purchased", `${unit.purchaseDate ?? "-"}${unit.dealerName ? ` from ${unit.dealerName}` : ""}`],
          ["Warranty", `${unit.warrantyStart ?? "-"} to ${unit.warrantyEnd ?? "-"}`],
          ...extendedWarrantyLine(unit),
          ["Status", unit.status],
        ]),
      });
    },
  },
  {
    method: "GET",
    path: "/units/:serial/coverage",
    roles: ALL,
    handler: (ctx, p) => unitCoverage(ctx, p.serial ?? ""),
  },
  {
    method: "GET",
    path: "/units/:serial/extension",
    roles: ALL,
    handler: (ctx, p) => unitExtensionQuote(ctx, p.serial ?? ""),
  },
  {
    method: "POST",
    path: "/units/:serial/extensions",
    roles: ALL,
    handler: (ctx, p, req) => extendWarranty(ctx, p.serial ?? "", body(req)),
  },
  {
    method: "POST",
    path: "/units/:serial/void",
    roles: ADMIN,
    handler: (ctx, p, req) => voidWarranty(ctx, p.serial ?? "", body(req)),
  },

  // ---- registrations ----
  {
    method: "GET",
    path: "/registrations",
    roles: ALL,
    handler: (ctx, _p, req) => listRegistrations(ctx, req.query),
  },
  {
    method: "POST",
    path: "/registrations",
    roles: ALL,
    handler: (ctx, _p, req) => createRegistration(ctx, req.body),
  },
  {
    method: "POST",
    path: "/registrations/bulk-approve",
    roles: ADMIN,
    handler: (ctx, _p, req) => bulkApproveRegistrations(ctx, body(req).ids),
  },
  {
    method: "GET",
    path: "/registrations/:id",
    roles: ALL,
    handler: (ctx, p) => getRegistration(ctx, p.id ?? ""),
  },
  {
    method: "POST",
    path: "/registrations/:id/approve",
    roles: ADMIN,
    handler: (ctx, p) => approveRegistration(ctx, p.id ?? ""),
  },
  {
    method: "POST",
    path: "/registrations/:id/reject",
    roles: ADMIN,
    handler: (ctx, p, req) => rejectRegistration(ctx, p.id ?? "", body(req).reason),
  },
  {
    method: "POST",
    path: "/registrations/:id/merge",
    roles: ADMIN,
    handler: (ctx, p) => mergeRegistration(ctx, p.id ?? ""),
  },

  // ---- bulk imports ----
  {
    method: "GET",
    path: "/bulk-imports/template.csv",
    roles: ALL,
    cookie: true,
    handler: () =>
      new Download({
        name: "registration-template.csv",
        mime: "text/csv; charset=utf-8",
        disposition: "attachment",
        data: templateCsv(),
      }),
  },
  {
    method: "GET",
    path: "/bulk-imports/template.xlsx",
    roles: ALL,
    cookie: true,
    // Excel needs exceljs: the demo server answers this route itself (src/app.ts).
    handler: () => {
      throw notFound("Excel template");
    },
  },
  {
    method: "POST",
    path: "/bulk-imports",
    roles: STAFF,
    status: 201,
    handler: (ctx, _p, req) => {
      if (!req.file) throw validation("Choose a file to upload.");
      if (req.file.size > BULK_IMPORT_MAX_BYTES)
        throw new ServiceError(413, "too_large", "Sheets can be up to 5 MB.");
      const fileName = (field(req, "name")?.trim() || req.file.name).slice(0, 255);
      if (!/\.(xlsx|csv)$/i.test(fileName))
        throw new ServiceError(415, "unsupported_type", "Upload an Excel (.xlsx) or CSV file.");
      if (!req.sheet)
        throw new ServiceError(
          415,
          "unsupported_type",
          "The file couldn't be read. Use the template and try again.",
        );
      return createBulkImport(ctx, {
        fileName,
        dealerId: field(req, "dealerId"),
        rows: rowsFromMatrix(req.sheet),
      });
    },
  },
  { method: "GET", path: "/bulk-imports", roles: STAFF, handler: (ctx) => listBulkImports(ctx) },
  {
    method: "GET",
    path: "/bulk-imports/:id",
    roles: STAFF,
    handler: (ctx, p) => getBulkImport(ctx, p.id ?? ""),
  },
  {
    method: "PUT",
    path: "/bulk-imports/:id/rows",
    roles: STAFF,
    handler: (ctx, p, req) => resubmitBulkRows(ctx, p.id ?? "", body(req).rows),
  },

  // ---- warranty claims ----
  { method: "GET", path: "/claims", roles: ALL, handler: (ctx, _p, req) => listClaims(ctx, req.query) },
  { method: "GET", path: "/claims/counts", roles: ALL, handler: (ctx) => claimCounts(ctx) },
  { method: "GET", path: "/claims/:id", roles: ALL, handler: (ctx, p) => getClaim(ctx, p.id ?? "") },
  { method: "POST", path: "/claims", roles: ALL, handler: (ctx, _p, req) => createClaim(ctx, body(req)) },
  {
    method: "POST",
    path: "/claims/:id/transitions",
    roles: ADMIN,
    handler: (ctx, p, req) => claimTransition(ctx, p.id ?? "", body(req)),
  },

  // ---- catalogue, organisation, intake ----
  {
    method: "GET",
    path: "/models",
    roles: ALL,
    handler: (ctx) => listModels(ctx.state, ctx.user.role === "admin"),
  },
  {
    method: "PATCH",
    path: "/models/:id",
    roles: ADMIN,
    handler: (ctx, p, req) => updateModel(ctx, p.id ?? "", body(req)),
  },
  { method: "GET", path: "/categories", roles: ALL, handler: (ctx) => listCategories(ctx.state) },
  { method: "GET", path: "/dealers", roles: STAFF, handler: (ctx) => listDealers(ctx) },
  { method: "GET", path: "/admin/org", roles: ADMIN, handler: (ctx) => orgStructure(ctx) },
  { method: "GET", path: "/intake", roles: STAFF, handler: (ctx) => intakeInfo(ctx) },
  { method: "GET", path: "/admin/partner-clients", roles: ADMIN, handler: (ctx) => listPartnerClients(ctx) },
  {
    method: "POST",
    path: "/admin/partner-clients",
    roles: ADMIN,
    status: 201,
    handler: (ctx, _p, req) => createPartnerClient(ctx, body(req)),
  },
  {
    method: "PATCH",
    path: "/admin/partner-clients/:id",
    roles: ADMIN,
    handler: (ctx, p, req) => setPartnerActive(ctx, p.id ?? "", body(req).active === true),
  },

  // ---- integration log, dashboard, notifications, files ----
  {
    method: "GET",
    path: "/integrations",
    roles: ADMIN,
    handler: (ctx, _p, req) => listIntegrations(ctx, req.query),
  },
  {
    method: "POST",
    path: "/integrations/:id/retry",
    roles: ADMIN,
    handler: (ctx, p) => retryIntegration(ctx, p.id ?? ""),
  },
  {
    method: "GET",
    path: "/dashboard/summary",
    roles: ALL,
    handler: (ctx, _p, req) => dashboardSummary(ctx, req.query),
  },
  {
    method: "GET",
    path: "/dashboard/finance",
    roles: STAFF,
    handler: (ctx, _p, req) => financeSummary(ctx, req.query),
  },
  { method: "GET", path: "/notifications", handler: (ctx) => listNotifications(ctx) },
  {
    method: "POST",
    path: "/notifications/read",
    handler: (ctx, _p, req) => {
      markNotificationsRead(ctx, body(req).ids);
      return { ok: true };
    },
  },
  {
    method: "POST",
    path: "/uploads",
    status: 201,
    handler: (ctx, _p, req) => addAttachment(ctx, req.file, field(req, "name")),
  },
  {
    method: "GET",
    path: "/files/:id",
    cookie: true,
    handler: (ctx, p) => {
      const attachment = getAttachment(ctx, p.id ?? "");
      const data = ctx.files.load(attachment.id);
      if (data === undefined) throw notFound("File");
      return new Download({ name: attachment.name, mime: attachment.mime, disposition: "inline", data });
    },
  },

  // ---- System events (A13) ----
  { method: "POST", path: "/simulate/erp-invoice", roles: ADMIN, handler: (ctx) => simulateErpInvoice(ctx) },
  {
    method: "POST",
    path: "/simulate/registration-email",
    roles: ADMIN,
    handler: (ctx) => simulateRegistrationEmail(ctx),
  },
  {
    method: "POST",
    path: "/simulate/marketplace-order",
    roles: ADMIN,
    handler: (ctx) => simulateMarketplaceOrder(ctx),
  },
  {
    method: "POST",
    path: "/simulate/joblink-registration",
    roles: ADMIN,
    handler: (ctx) => simulateJoblinkRegistration(ctx),
  },
  {
    method: "POST",
    path: "/simulate/overwatch-registration",
    roles: ADMIN,
    handler: (ctx) => simulateOverwatchRegistration(ctx),
  },
];

function matchPath(pattern: string, path: string): Params | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Params = {};
  for (let i = 0; i < a.length; i += 1) {
    const seg = a[i] ?? "";
    if (seg.startsWith(":")) params[seg.slice(1)] = decodeURIComponent(b[i] ?? "");
    else if (seg !== b[i]) return null;
  }
  return params;
}

/** The error body of every failure: { code, message, fieldErrors?, requestId }. */
export const errorBody = (e: ServiceError) => ({
  code: e.code,
  message: e.message,
  fieldErrors: e.fieldErrors,
  requestId: crypto.randomUUID(),
});

const memoryStores = new WeakMap<DemoDb, Map<string, DemoFileData>>();

function fileStoreFor(db: DemoDb): FileStore {
  let memory = memoryStores.get(db);
  if (!memory) memoryStores.set(db, (memory = new Map()));
  const fallback = memory;
  return {
    url: db.fileUrl ?? ((id) => `/api/files/${encodeURIComponent(id)}`),
    save: (attachment, data) =>
      db.files ? db.files.save(attachment, data) : void fallback.set(attachment.id, data),
    load: (id) => (db.files ? db.files.load(id) : fallback.get(id)),
  };
}

export function systemContextFor(db: DemoDb): SystemCtx {
  const now = new Date();
  return {
    state: db.state,
    today: db.today?.() ?? todayIso(now),
    now: now.toISOString(),
    files: fileStoreFor(db),
  };
}

export const contextFor = (db: DemoDb, user: User): Ctx => ({ ...systemContextFor(db), user });

export function userFromToken(
  db: DemoDb,
  sessions: SessionStore,
  token: string | undefined,
): User | undefined {
  const userId = sessions.get(token);
  return userId ? db.state.users.find((u) => u.id === userId) : undefined;
}

function respond(result: unknown, status: number): DemoResponse {
  return result instanceof Download ? { status: 200, download: result.file } : { status, body: result };
}

export function dispatch(db: DemoDb, sessions: SessionStore, req: DemoRequest): DemoResponse {
  const method = req.method.toUpperCase();
  try {
    // ---- auth (no access token needed) ----
    if (method === "POST" && req.path === "/auth/login") {
      const { email, password } = body(req);
      const user = authenticate(db.state, email, password);
      return {
        status: 200,
        body: { accessToken: sessions.create(user.id), user: toSessionUser(db.state, user) },
        setRefreshToken: sessions.create(user.id),
      };
    }
    if (method === "POST" && req.path === "/auth/refresh") {
      const user = userFromToken(db, sessions, req.refreshToken);
      if (!user) throw unauthenticated();
      return {
        status: 200,
        body: { accessToken: sessions.create(user.id), user: toSessionUser(db.state, user) },
        setRefreshToken: req.refreshToken,
      };
    }
    if (method === "POST" && req.path === "/auth/logout") {
      sessions.delete(req.refreshToken);
      sessions.delete(req.accessToken);
      return { status: 204, clearRefreshToken: true };
    }

    // Replaces all data with the starting data, dated from today. Signed-in seeded users stay signed in.
    if (method === "POST" && req.path === "/simulate/reset") {
      const user = userFromToken(db, sessions, req.accessToken);
      if (!user) throw unauthenticated();
      requireRole(contextFor(db, user), "admin");
      db.state = createSeed(contextFor(db, user).today);
      db.onChange?.(db.state);
      return { status: 200, body: { ok: true } };
    }

    for (const route of routes) {
      if (route.method !== method) continue;
      const params = matchPath(route.path, req.path);
      if (!params) continue;
      const write = method !== "GET";
      const run = () => {
        if (route.public) return route.handler(systemContextFor(db), params, req, db);
        const user =
          userFromToken(db, sessions, req.accessToken) ??
          (route.cookie ? userFromToken(db, sessions, req.refreshToken) : undefined);
        if (!user) throw unauthenticated();
        const ctx = contextFor(db, user);
        if (route.roles) requireRole(ctx, ...route.roles);
        return route.handler(ctx, params, req);
      };
      // Each write is all-or-nothing, like the backend's transaction.
      const result = write ? transaction(db.state, run) : run();
      if (write) db.onChange?.(db.state);
      return respond(result, route.status ?? 200);
    }
    return {
      status: 404,
      body: { code: "not_found", message: "Not found.", requestId: crypto.randomUUID() },
    };
  } catch (e) {
    if (e instanceof ServiceError) return { status: e.status, body: errorBody(e) };
    throw e;
  }
}
