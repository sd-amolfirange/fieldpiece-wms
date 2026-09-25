import type { FastifyReply } from "fastify";

/** RFC 6266 filename, with an ASCII fallback. */
export function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Headers for serving a stored file to the web app: it may be embedded in the app's own pages (<img>, <object>),
 * never sniffed as another type, and never run script. PDFs skip the CSP sandbox, which would stop the browser's
 * PDF viewer.
 */
export function fileHeaders(reply: FastifyReply, mime: string, disposition: string, frameAncestors: string[]): void {
  const ancestors = ["'self'", ...frameAncestors].join(" ");
  void reply
    .header("Content-Type", mime)
    .header("Content-Disposition", disposition)
    .header("Cache-Control", "private, max-age=300")
    .header("X-Content-Type-Options", "nosniff")
    .header("Cross-Origin-Resource-Policy", "same-site")
    .header(
      "Content-Security-Policy",
      mime === "application/pdf"
        ? `default-src 'none'; frame-ancestors ${ancestors}`
        : `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors ${ancestors}; sandbox`,
    );
  // Helmet writes this on the raw response (frame-ancestors above replaces it for files).
  reply.raw.removeHeader("X-Frame-Options");
}
