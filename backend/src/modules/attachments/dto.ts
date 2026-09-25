import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { OWNER_TYPES } from "./file-policy";

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  ownerType: z.enum(OWNER_TYPES),
  ownerId: z.string().uuid().nullable(),
  fileName: z.string().describe("e.g. receipt.pdf"),
  mimeType: z.string().describe("e.g. application/pdf"),
  sizeBytes: z.number().int(),
  scanStatus: z.enum(["PENDING", "CLEAN", "INFECTED", "ERROR"]),
  uploaded: z.boolean().describe("True once the client confirmed the upload"),
  createdAt: z.string().datetime(),
});
export type AttachmentResponse = z.infer<typeof attachmentSchema>;
export class AttachmentDto extends createZodDto(attachmentSchema) {}

export class UploadUrlRequestDto extends createZodDto(
  z.object({
    fileName: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe("Original name, shown to users only; never used as the storage key"),
    mimeType: z.string().trim().toLowerCase().max(100),
    sizeBytes: z.number().int().positive(),
    ownerType: z.enum(OWNER_TYPES),
  }),
) {}

export class UploadUrlResponseDto extends createZodDto(
  z.object({
    attachment: attachmentSchema,
    uploadUrl: z.string().url(),
    method: z.literal("PUT"),
    headers: z.record(z.string()).describe("Send these headers with the PUT"),
    expiresAt: z.string().datetime(),
  }),
) {}

export class DownloadUrlResponseDto extends createZodDto(
  z.object({ url: z.string().url(), expiresAt: z.string().datetime() }),
) {}
