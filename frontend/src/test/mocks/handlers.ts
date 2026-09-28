import { http, HttpResponse } from "msw";
import { dispatch, parseCsv, type DemoFile, type DemoRequest, type DemoResponse } from "@demo-core";
import { basePath, mockDb, mockSessions } from "./db";
import { legacyHandlers } from "./legacy-handlers";

// TEST-ONLY MSW adapter over the mock API core (backend/demo-server/src/core via `@demo-core`), which mirrors the real
// backend's API, so unit tests hit the same endpoints, scoping and errors. Only transport details live here: JSON and
// multipart bodies (uploads, the public registration form, bulk sheets), headers, the refresh "cookie" and file
// answers. Every request goes through the core's dispatch().

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

/** Routes where the backend reads the refresh cookie: refresh, logout and file downloads (<img src>, links). */
const COOKIE_ROUTES =
  /^\/(auth\/(refresh|logout)|files\/|units\/[^/]+\/certificate\.pdf$|bulk-imports\/template\.)/;

const bearer = (request: Request) =>
  request.headers.get("Authorization")?.replace(/^Bearer /i, "") || undefined;

// Duck-typed: in tests the parsed file comes from a different realm than jsdom's File class.
const isFile = (entry: unknown): entry is File =>
  typeof entry === "object" && !!entry && "arrayBuffer" in entry && "name" in entry;

/** JSON body, or a multipart form's text fields plus its `file` part. */
async function readBody(request: Request): Promise<Pick<DemoRequest, "body" | "file">> {
  if (request.method === "GET" || request.method === "HEAD") return {};
  if (request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
    const form = await request.formData();
    const fields: Record<string, string> = {};
    let file: DemoFile | undefined;
    form.forEach((value, key) => {
      if (typeof value === "string") fields[key] = value;
    });
    const entry = form.get("file");
    if (isFile(entry)) {
      const data = new Uint8Array(await entry.arrayBuffer());
      file = {
        name: entry.name || "upload",
        mime: entry.type || "application/octet-stream",
        size: data.length,
        data,
      };
    }
    return { body: fields, file };
  }
  const text = await request.text();
  return { body: text ? (JSON.parse(text) as unknown) : undefined };
}

/** POST /bulk-imports: the sheet as a string matrix. Tests upload CSV; .xlsx can't be read here (no exceljs). */
function readSheet(body: unknown, file: DemoFile | undefined): string[][] | null | undefined {
  if (!file) return undefined;
  const fields = (body ?? {}) as Record<string, string | undefined>;
  const name = fields.name?.trim() || file.name;
  if (!/\.csv$/i.test(name)) return null;
  const data = file.data ?? "";
  return parseCsv(typeof data === "string" ? data : new TextDecoder().decode(data));
}

function toHttp(res: DemoResponse) {
  if (res.download) {
    const { download } = res;
    return new HttpResponse(download.data, {
      status: 200,
      headers: {
        "Content-Type": download.mime,
        "Content-Disposition": `${download.disposition}; filename="${download.name}"`,
      },
    });
  }
  return res.status === 204 || res.body === undefined
    ? new HttpResponse(null, { status: res.status })
    : HttpResponse.json(res.body as Record<string, unknown>, { status: res.status });
}

export const handlers = [
  ...legacyHandlers(api),

  http.all(api("/*"), async ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.slice(url.pathname.indexOf(basePath) + basePath.length) || "/";
    let read: Pick<DemoRequest, "body" | "file">;
    try {
      read = await readBody(request);
    } catch {
      return HttpResponse.json(
        { code: "bad_request", message: "The request couldn't be read. Check the format." },
        { status: 400 },
      );
    }
    const storedUser = readSession();
    const res = dispatch(mockDb, mockSessions, {
      method: request.method,
      path,
      query: Object.fromEntries(url.searchParams),
      ...read,
      headers: {
        "x-api-key": request.headers.get("X-Api-Key") ?? undefined,
        "x-inbound-secret": request.headers.get("X-Inbound-Secret") ?? undefined,
      },
      sheet:
        request.method === "POST" && path === "/bulk-imports" ? readSheet(read.body, read.file) : undefined,
      accessToken: bearer(request),
      refreshToken: storedUser && COOKIE_ROUTES.test(path) ? mockSessions.create(storedUser) : undefined,
    });
    if (res.setRefreshToken) writeSession(mockSessions.get(res.setRefreshToken) ?? null);
    if (res.clearRefreshToken) writeSession(null);
    return toHttp(res);
  }),
];
