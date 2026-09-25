import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { isoDateString, serialNumber, uuid } from "../../common/validation/schemas";
import { attachmentSchema } from "../attachments";
import { customerInputSchema } from "../customers";

export const WARRANTY_STATUSES = ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID"] as const;

export const registrationSchema = z.object({
  id: z.string().uuid(),
  serialNumber: z.string().describe("e.g. SC680-100037"),
  sku: z.string(),
  productName: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  distributorId: z.string().uuid().nullable(),
  policyId: z.string().uuid(),
  purchaseDate: z.string().describe("YYYY-MM-DD"),
  warrantyStart: z.string(),
  warrantyEnd: z.string(),
  status: z.enum(WARRANTY_STATUSES).describe("Computed at read time from warrantyEnd (Section 5.3)"),
  replacesRegistrationId: z.string().uuid().nullable(),
  certificateReady: z.boolean(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
});
export type RegistrationResponse = z.infer<typeof registrationSchema>;
export class RegistrationDto extends createZodDto(registrationSchema) {}
export class RegistrationPageDto extends createZodDto(paginatedSchema(registrationSchema)) {}

export const registrationDetailSchema = registrationSchema.extend({
  proofOfPurchase: z.array(attachmentSchema),
  claimCount: z.number().int(),
});
export type RegistrationDetailResponse = z.infer<typeof registrationDetailSchema>;
export class RegistrationDetailDto extends createZodDto(registrationDetailSchema) {}

export class RegistrationListQueryDto extends createZodDto(
  pageQuerySchema.extend({
    status: z.enum(WARRANTY_STATUSES).optional(),
    customerId: uuid.optional(),
    sku: z.string().trim().toUpperCase().optional(),
    serial: serialNumber.optional().describe("Exact serial match"),
  }),
) {}

export const createRegistrationSchema = z
  .object({
    serialNumber: serialNumber.describe("Normalised: trimmed, spaces removed, upper case"),
    sku: z.string().trim().toUpperCase().min(1, "Pick the product.").describe("e.g. SC680"),
    purchaseDate: isoDateString,
    customerId: uuid.optional().describe("Existing customer (distributors, agents, admins)"),
    customer: customerInputSchema.optional().describe("New owner details, or a technician's own details"),
    distributorId: uuid.nullable().optional().describe("Agents and admins only"),
    proofOfPurchaseIds: z.array(uuid).max(5).default([]),
  })
  .refine((v) => !(v.customerId && v.customer), {
    path: ["customer"],
    message: "Send either customerId or customer, not both.",
  });
export type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
export class CreateRegistrationDto extends createZodDto(createRegistrationSchema) {}

export class VoidRegistrationDto extends createZodDto(
  z.object({ reason: z.string().trim().min(5, "Say why this registration is being voided.").max(500) }),
) {}

export class CertificateUrlDto extends createZodDto(
  z.object({ url: z.string().url(), expiresAt: z.string().datetime() }),
) {}

export class StartImportDto extends createZodDto(
  z.object({ attachmentId: uuid.describe("A CLEAN text/csv upload") }),
) {}

export const importStatusSchema = z.object({
  jobId: z.string().uuid(),
  state: z.enum(["queued", "running", "completed", "failed"]),
  total: z.number().int(),
  processed: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  message: z.string().nullable(),
  errorReportUrl: z.string().url().nullable().describe("Presigned CSV of rejected rows, 5-minute expiry"),
});
export type ImportStatus = z.infer<typeof importStatusSchema>;
export class ImportStatusDto extends createZodDto(importStatusSchema) {}
