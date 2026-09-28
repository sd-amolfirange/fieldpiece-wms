import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import {
  BULK_IMPORT_MAX_BYTES,
  dispatch,
  errorBody,
  MAX_UPLOAD_BYTES,
  ServiceError,
  userFromToken,
  type DemoDb,
  type DemoResponse,
  type SessionStore,
} from "./core/index";
import { readSheet, templateXlsx } from "./documents";

// Express adapter over the mock API in ./core. Every window and the phone talk to this one process, so they all see
// the same state. Endpoint logic lives in the core; this file only handles HTTP details: cookies, multipart forms,
// reading bulk sheets, file downloads and serving the built frontend.

export const API_BASE = "/api";
const REFRESH_COOKIE = "wms_refresh";

export interface AppOptions {
  db: DemoDb;
  sessions: SessionStore;
  uploadsDir: string;
  /** Built frontend (frontend/dist) to serve next to the API, for the single-URL demo. */
  staticDir?: string;
}

const bearer = (req: Request) => req.get("authorization")?.replace(/^Bearer /i, "") || undefined;

function sendError(res: Response, e: unknown) {
  if (e instanceof ServiceError) {
    res.status(e.status).json(errorBody(e));
    return;
  }
  console.error(e);
  res.status(500).json({ code: "server_error", message: "Something went wrong. Try again." });
}

/** RFC 6266 filename, with an ASCII fallback. */
const contentDisposition = (kind: "inline" | "attachment", fileName: string) =>
  `${kind}; filename="${fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;

/** Multipart form with at most one `file` part, held in memory. Oversized files answer 413 too_large. */
function multipart(maxBytes: number, tooLargeMessage: string) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1 } }).single(
    "file",
  );
  return (req: Request, res: Response, next: NextFunction) =>
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      const tooLarge = err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
      sendError(
        res,
        tooLarge
          ? new ServiceError(413, "too_large", tooLargeMessage)
          : new ServiceError(400, "upload_failed", "The upload didn't go through. Try again."),
      );
    });
}

function send(res: Response, result: DemoResponse) {
  if (result.download) {
    const { download } = result;
    res
      .status(200)
      .type(download.mime)
      .setHeader("Content-Disposition", contentDisposition(download.disposition, download.name));
    res.setHeader(
      "Cache-Control",
      download.disposition === "inline" ? "private, max-age=300" : "private, no-store",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(
      typeof download.data === "string" ? Buffer.from(download.data, "utf8") : Buffer.from(download.data),
    );
    return;
  }
  if (result.body === undefined) res.status(result.status).end();
  else res.status(result.status).json(result.body);
}

export function createApp({ db, sessions, uploadsDir, staticDir }: AppOptions) {
  mkdirSync(uploadsDir, { recursive: true });
  // Uploaded bytes live on disk next to the saved state.
  db.fileUrl ??= (id) => `${API_BASE}/files/${encodeURIComponent(id)}`;
  db.files ??= {
    save: (attachment, data) => writeFileSync(join(uploadsDir, attachment.id), data),
    load: (id) => {
      const path = join(uploadsDir, id);
      return existsSync(path) ? readFileSync(path) : undefined;
    },
  };

  const app = express();
  // Behind a tunnel the public URL is HTTPS: trust X-Forwarded-Proto so cookies get the Secure flag.
  app.set("trust proxy", true);
  app.use(cookieParser());
  app.use(API_BASE, express.json({ limit: "1mb" }));

  const cookieOptions = (req: Request) => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req.secure,
    path: API_BASE,
    maxAge: 1000 * 60 * 60 * 24 * 14,
  });

  // ---- multipart forms: the core gets the text fields as the body and the file part as `file` ----
  const uploadForm = multipart(MAX_UPLOAD_BYTES, "Files can be up to 15 MB.");
  app.post(`${API_BASE}/uploads`, uploadForm);
  app.post(`${API_BASE}/public/registrations`, uploadForm);
  // Bulk upload (DL02): the sheet is read here (exceljs), validated and imported in the core.
  app.post(
    `${API_BASE}/bulk-imports`,
    multipart(BULK_IMPORT_MAX_BYTES, "Sheets can be up to 5 MB."),
    async (req, res, next) => {
      const name =
        (typeof req.body?.name === "string" && req.body.name.trim()) || req.file?.originalname || "";
      if (req.file && /\.(xlsx|csv)$/i.test(name)) {
        try {
          res.locals.sheet = await readSheet(name, req.file.buffer);
        } catch {
          res.locals.sheet = null;
        }
      }
      next();
    },
  );

  // Excel template: needs exceljs, so it's answered here (bearer token, or the session cookie for plain links).
  app.get(`${API_BASE}/bulk-imports/template.xlsx`, async (req, res) => {
    const user =
      userFromToken(db, sessions, bearer(req)) ??
      userFromToken(db, sessions, req.cookies?.[REFRESH_COOKIE] as string | undefined);
    if (!user)
      return sendError(res, new ServiceError(401, "unauthenticated", "Session expired. Sign in again."));
    res
      .type("xlsx")
      .setHeader("Content-Disposition", contentDisposition("attachment", "registration-template.xlsx"))
      .send(await templateXlsx());
  });

  // ---- everything else: the shared dispatcher ----
  app.use(API_BASE, (req, res) => {
    try {
      const result = dispatch(db, sessions, {
        method: req.method,
        path: req.path,
        query: Object.fromEntries(
          Object.entries(req.query).map(([k, v]) => [k, typeof v === "string" ? v : undefined]),
        ),
        body: req.body as unknown,
        headers: {
          "x-api-key": req.get("x-api-key"),
          "x-inbound-secret": req.get("x-inbound-secret"),
        },
        file: req.file
          ? {
              name: req.file.originalname,
              mime: req.file.mimetype,
              size: req.file.size,
              data: req.file.buffer,
            }
          : undefined,
        sheet: res.locals.sheet as string[][] | null | undefined,
        accessToken: bearer(req),
        refreshToken: req.cookies?.[REFRESH_COOKIE] as string | undefined,
      });
      if (result.setRefreshToken) res.cookie(REFRESH_COOKIE, result.setRefreshToken, cookieOptions(req));
      if (result.clearRefreshToken) res.clearCookie(REFRESH_COOKIE, { path: API_BASE });
      send(res, result);
    } catch (e) {
      sendError(res, e);
    }
  });

  // ---- built frontend (single-URL demo) ----
  if (staticDir && existsSync(join(staticDir, "index.html"))) {
    app.use(express.static(staticDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith(API_BASE)) return next();
      res.sendFile(resolve(staticDir, "index.html"));
    });
  }

  return app;
}
