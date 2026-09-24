import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import cookieParser from "cookie-parser";
import express, { type Request, type Response } from "express";
import multer from "multer";
import {
  addAttachment,
  contextFor,
  createBulkImport,
  dispatch,
  getAttachment,
  getUnit,
  rowsFromMatrix,
  templateCsv,
  MAX_UPLOAD_BYTES,
  ServiceError,
  userFromToken,
  type DemoDb,
  type SessionStore,
} from "./core/index";
import { certificatePdf, readSheet, templateXlsx } from "./documents";

// Express adapter over the demo API in ./core. Every window and the phone talk to this
// one process, so they all see the same state. Endpoint logic lives in demo-core; this file only handles
// HTTP details: cookies, multipart uploads, file downloads and serving the built frontend.

export const API_BASE = "/api";
const REFRESH_COOKIE = "wms_refresh";

export interface AppOptions {
  db: DemoDb;
  sessions: SessionStore;
  uploadsDir: string;
  /** Built frontend (frontend/dist) to serve next to the API, for the single-URL demo. */
  staticDir?: string;
}

const bearer = (req: Request) =>
  req.get("authorization")?.replace(/^Bearer /, "") || undefined;

function sendError(res: Response, e: unknown) {
  if (e instanceof ServiceError) {
    res
      .status(e.status)
      .json({ code: e.code, message: e.message, fieldErrors: e.fieldErrors });
    return;
  }
  console.error(e);
  res.status(500).json({
    code: "server_error",
    message: "Something went wrong on the demo server.",
  });
}

export function createApp({ db, sessions, uploadsDir, staticDir }: AppOptions) {
  mkdirSync(uploadsDir, { recursive: true });
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

  // ---- uploads (multipart) ----
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  });
  app.post(`${API_BASE}/uploads`, (req, res) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const tooLarge =
          err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE";
        res.status(tooLarge ? 413 : 400).json({
          code: tooLarge ? "too_large" : "upload_failed",
          message: tooLarge
            ? "Files can be up to 15 MB."
            : "The upload didn't go through. Try again.",
        });
        return;
      }
      try {
        const user = userFromToken(db, sessions, bearer(req));
        if (!user)
          throw new ServiceError(
            401,
            "unauthenticated",
            "Session expired. Sign in again.",
          );
        if (!req.file)
          throw new ServiceError(
            422,
            "validation_error",
            "Choose a file to upload.",
          );
        const name =
          (typeof req.body?.name === "string" && req.body.name) ||
          req.file.originalname;
        const attachment = addAttachment(
          contextFor(db, user),
          { name, mime: req.file.mimetype, size: req.file.size },
          (id) => `${API_BASE}/files/${id}`,
        );
        writeFileSync(join(uploadsDir, attachment.id), req.file.buffer);
        db.onChange?.(db.state);
        res.status(201).json(attachment);
      } catch (e) {
        sendError(res, e);
      }
    });
  });

  // ---- file downloads: <img src> can't send the bearer token, so the refresh cookie also works ----
  app.get(`${API_BASE}/files/:id`, (req, res) => {
    try {
      const user =
        userFromToken(db, sessions, bearer(req)) ??
        userFromToken(
          db,
          sessions,
          req.cookies?.[REFRESH_COOKIE] as string | undefined,
        );
      if (!user)
        throw new ServiceError(
          401,
          "unauthenticated",
          "Session expired. Sign in again.",
        );
      const attachment = getAttachment(contextFor(db, user), req.params.id);
      const path = join(uploadsDir, attachment.id);
      if (!existsSync(path))
        throw new ServiceError(404, "not_found", "File not found.");
      res.type(attachment.mime);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${encodeURIComponent(attachment.name)}"`,
      );
      res.setHeader("Cache-Control", "private, max-age=300");
      res.sendFile(resolve(path));
    } catch (e) {
      sendError(res, e);
    }
  });

  // ---- bulk upload (DL02): read the sheet here, validate and import in the core ----
  app.get(`${API_BASE}/bulk-imports/template.csv`, (_req, res) => {
    res
      .type("text/csv")
      .attachment("registration-template.csv")
      .send(templateCsv());
  });
  app.get(`${API_BASE}/bulk-imports/template.xlsx`, async (_req, res) => {
    res
      .type("xlsx")
      .attachment("registration-template.xlsx")
      .send(await templateXlsx());
  });
  const sheetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post(
    `${API_BASE}/bulk-imports`,
    sheetUpload.single("file"),
    async (req, res) => {
      try {
        const user = userFromToken(db, sessions, bearer(req));
        if (!user)
          throw new ServiceError(
            401,
            "unauthenticated",
            "Session expired. Sign in again.",
          );
        if (!req.file)
          throw new ServiceError(
            422,
            "validation_error",
            "Choose a file to upload.",
          );
        const fileName =
          (typeof req.body?.name === "string" && req.body.name) ||
          req.file.originalname;
        if (!/\.(xlsx|csv)$/i.test(fileName)) {
          throw new ServiceError(
            415,
            "unsupported_type",
            "Upload an Excel (.xlsx) or CSV file.",
          );
        }
        const rows = rowsFromMatrix(await readSheet(fileName, req.file.buffer));
        const dealerId =
          typeof req.body?.dealerId === "string"
            ? req.body.dealerId
            : undefined;
        const batch = createBulkImport(contextFor(db, user), {
          fileName,
          dealerId,
          rows,
        });
        db.onChange?.(db.state);
        res.status(201).json(batch);
      } catch (e) {
        sendError(res, e);
      }
    },
  );

  // ---- warranty certificate PDF (bearer token, or the refresh cookie for plain links) ----
  app.get(`${API_BASE}/units/:serial/certificate.pdf`, (req, res) => {
    try {
      const user =
        userFromToken(db, sessions, bearer(req)) ??
        userFromToken(
          db,
          sessions,
          req.cookies?.[REFRESH_COOKIE] as string | undefined,
        );
      if (!user)
        throw new ServiceError(
          401,
          "unauthenticated",
          "Session expired. Sign in again.",
        );
      const unit = getUnit(contextFor(db, user), req.params.serial);
      if (!unit.parts.length)
        throw new ServiceError(
          409,
          "not_registered",
          "This unit isn't registered yet.",
        );
      res
        .type("pdf")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="warranty-${unit.serial}.pdf"`,
        );
      certificatePdf(unit).pipe(res);
    } catch (e) {
      sendError(res, e);
    }
  });

  // ---- everything else: the shared dispatcher ----
  app.use(API_BASE, (req, res) => {
    try {
      const result = dispatch(db, sessions, {
        method: req.method,
        path: req.path,
        query: Object.fromEntries(
          Object.entries(req.query).map(([k, v]) => [
            k,
            typeof v === "string" ? v : undefined,
          ]),
        ),
        body: req.body as unknown,
        accessToken: bearer(req),
        refreshToken: req.cookies?.[REFRESH_COOKIE] as string | undefined,
      });
      if (result.setRefreshToken)
        res.cookie(REFRESH_COOKIE, result.setRefreshToken, cookieOptions(req));
      if (result.clearRefreshToken)
        res.clearCookie(REFRESH_COOKIE, { path: API_BASE });
      if (result.body === undefined) res.status(result.status).end();
      else res.status(result.status).json(result.body);
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
