import { http, HttpResponse } from "msw";
import {
  addAttachment,
  contextFor,
  createBulkImport,
  dispatch,
  getAttachment,
  parseCsv,
  rowsFromMatrix,
  ServiceError,
  userFromToken,
  type DemoResponse,
} from "@demo-core";
import { env } from "@/lib/env";
import { mockDb, mockFiles, mockSessions } from "./db";
import { legacyHandlers } from "./legacy-handlers";

// TEST-ONLY MSW adapter over the backend's demo API (backend/demo-server/src/core via `@demo-core`), so unit
// tests hit the same endpoints, scoping and errors as the real demo server. Only transport details live here.

const basePath = new URL(env.apiBaseUrl, "http://localhost").pathname.replace(/\/$/, "");
const api = (path: string) => `*${basePath}${path}`;

// Stands in for the httpOnly refresh cookie.
const SESSION_KEY = "wms-mock-session";
const readSession = () => {
  try {
    return globalThis.sessionStorage?.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};
const writeSession = (userId: string | null) => {
  try {
    if (userId) globalThis.sessionStorage?.setItem(SESSION_KEY, userId);
    else globalThis.sessionStorage?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
};

const bearer = (request: Request) =>
  request.headers.get("Authorization")?.replace(/^Bearer /, "") || undefined;

const errorJson = (e: ServiceError) =>
  HttpResponse.json({ code: e.code, message: e.message, fieldErrors: e.fieldErrors }, { status: e.status });

function toHttp(res: DemoResponse) {
  return res.status === 204 || res.body === undefined
    ? new HttpResponse(null, { status: res.status })
    : HttpResponse.json(res.body as Record<string, unknown>, { status: res.status });
}

async function readBody(request: Request): Promise<unknown> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const text = await request.text();
  return text ? (JSON.parse(text) as unknown) : undefined;
}

export const handlers = [
  ...legacyHandlers(api),

  // Multipart upload: stores the file and returns its Attachment.
  http.post(api("/uploads"), async ({ request }) => {
    const user = userFromToken(mockDb, mockSessions, bearer(request));
    if (!user)
      return HttpResponse.json({ code: "unauthenticated", message: "Session expired." }, { status: 401 });
    // Duck-typed: in tests the parsed file comes from a different realm than jsdom's Blob class.
    const form = await request.formData();
    const entry = form.get("file");
    const file = typeof entry === "object" && entry && "arrayBuffer" in entry ? (entry as File) : null;
    if (!file) {
      return HttpResponse.json(
        { code: "validation_error", message: "Choose a file to upload." },
        { status: 422 },
      );
    }
    try {
      const fieldName = form.get("name");
      const name = (typeof fieldName === "string" && fieldName) || file.name || "upload";
      const attachment = addAttachment(
        contextFor(mockDb, user),
        { name, mime: file.type || "application/octet-stream", size: file.size },
        (id) => `${basePath}/files/${id}`,
      );
      mockFiles.set(attachment.id, file);
      return HttpResponse.json(attachment, { status: 201 });
    } catch (e) {
      if (e instanceof ServiceError) return errorJson(e);
      throw e;
    }
  }),

  // Bulk upload (CSV only in tests; the server also reads .xlsx).
  http.post(api("/bulk-imports"), async ({ request }) => {
    const user = userFromToken(mockDb, mockSessions, bearer(request));
    if (!user)
      return HttpResponse.json({ code: "unauthenticated", message: "Session expired." }, { status: 401 });
    const form = await request.formData();
    const entry = form.get("file");
    const file = typeof entry === "object" && entry && "text" in entry ? (entry as File) : null;
    if (!file)
      return HttpResponse.json({ code: "validation_error", message: "Choose a file." }, { status: 422 });
    const name = form.get("name");
    const dealerId = form.get("dealerId");
    try {
      const batch = createBulkImport(contextFor(mockDb, user), {
        fileName: typeof name === "string" && name ? name : "upload.csv",
        dealerId: typeof dealerId === "string" ? dealerId : undefined,
        rows: rowsFromMatrix(parseCsv(await file.text())),
      });
      return HttpResponse.json(batch, { status: 201 });
    } catch (e) {
      if (e instanceof ServiceError) return errorJson(e);
      throw e;
    }
  }),

  // File download. Browsers load these from <img src>, which can't carry the bearer token, so the mock
  // session (the refresh "cookie") also authenticates.
  http.get(api("/files/:id"), ({ request, params }) => {
    const userId = readSession();
    const user =
      userFromToken(mockDb, mockSessions, bearer(request)) ?? mockDb.state.users.find((u) => u.id === userId);
    if (!user) return new HttpResponse(null, { status: 401 });
    try {
      const attachment = getAttachment(contextFor(mockDb, user), String(params.id));
      const blob = mockFiles.get(attachment.id);
      if (!blob) return new HttpResponse(null, { status: 404 });
      return new HttpResponse(blob, { headers: { "Content-Type": attachment.mime } });
    } catch (e) {
      if (e instanceof ServiceError) return errorJson(e);
      throw e;
    }
  }),

  // Everything else goes through the shared dispatcher.
  http.all(api("/*"), async ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.slice(url.pathname.indexOf(basePath) + basePath.length) || "/";
    const storedUser = readSession();
    const res = dispatch(mockDb, mockSessions, {
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      body: await readBody(request),
      accessToken: bearer(request),
      refreshToken: path === "/auth/refresh" && storedUser ? mockSessions.create(storedUser) : undefined,
    });
    if (res.setRefreshToken) writeSession(mockSessions.get(res.setRefreshToken) ?? null);
    if (res.clearRefreshToken) writeSession(null);
    return toHttp(res);
  }),
];
