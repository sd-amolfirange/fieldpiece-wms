import type { FastifyRequest } from "fastify";
import { AppError } from "../errors/app-error";

export interface UploadedFile {
  fileName: string;
  mime: string;
  buffer: Buffer;
}

export interface MultipartForm {
  file?: UploadedFile;
  fields: Record<string, string>;
}

const isTooLarge = (err: unknown) => (err as { code?: string } | null)?.code === "FST_REQ_FILE_TOO_LARGE";

/**
 * Reads a multipart form with at most one file, whatever the field order (the frontend appends `name` after
 * `file`). The file is buffered in memory: uploads are capped at a few MB by `maxBytes`.
 */
export async function readMultipart(
  request: FastifyRequest,
  maxBytes: number,
  tooLargeMessage: string,
): Promise<MultipartForm> {
  if (!request.isMultipart()) return { fields: {} };
  const form: MultipartForm = { fields: {} };
  try {
    for await (const part of request.parts({ limits: { fileSize: maxBytes, files: 1, fields: 20, fieldSize: 10_000 } })) {
      if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (part.fieldname === "file" && !form.file) {
          form.file = { fileName: part.filename, mime: part.mimetype, buffer };
        }
      } else if (typeof part.value === "string") {
        form.fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    if (isTooLarge(err)) throw new AppError(413, "too_large", tooLargeMessage);
    throw new AppError(400, "upload_failed", "The upload didn't go through. Try again.");
  }
  return form;
}
