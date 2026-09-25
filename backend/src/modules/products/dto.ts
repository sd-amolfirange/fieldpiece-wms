import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIME } from "../../common/files/product-image";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { isoDateString } from "../../common/validation/schemas";

export const PRODUCT_FAMILIES = [
  "meters",
  "gauges",
  "vacuum",
  "leak_detection",
  "combustion",
  "airflow",
  "recovery",
  "other",
] as const;

export const productSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().describe("e.g. SC680"),
  name: z.string().describe("e.g. Clamp meter"),
  family: z.enum(PRODUCT_FAMILIES),
  serialPattern: z.string().nullable().describe("Regex source for serial validation [CONFIRM]"),
  launchDate: z.string().nullable().describe("YYYY-MM-DD"),
  imageUrl: z
    .string()
    .url()
    .nullable()
    .describe("Versioned, cacheable URL of the product photo; null when there is none"),
  isActive: z.boolean(),
  warrantyMonths: z.number().int().nullable().describe("Current base months from the policy in effect today"),
  registrationBonusMonths: z.number().int().nullable(),
});
export type ProductResponse = z.infer<typeof productSchema>;
export class ProductDto extends createZodDto(productSchema) {}
export class ProductPageDto extends createZodDto(paginatedSchema(productSchema)) {}

export class ProductListQueryDto extends createZodDto(
  pageQuerySchema.extend({
    family: z.enum(PRODUCT_FAMILIES).optional(),
    includeInactive: z.enum(["true", "false"]).optional(),
  }),
) {}

/** Admin-supplied regex runs against user input, so keep it short and make sure it compiles. */
const serialPattern = z
  .string()
  .max(200)
  .refine((source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  }, "That isn't a valid regular expression.");

export const createProductSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,30}$/, "Letters, digits and dashes only."),
  name: z.string().trim().min(1).max(120),
  family: z.enum(PRODUCT_FAMILIES),
  serialPattern: serialPattern.nullable().optional(),
  launchDate: isoDateString.nullable().optional(),
});
export class CreateProductDto extends createZodDto(createProductSchema) {}

export const updateProductSchema = createProductSchema
  .omit({ sku: true })
  .extend({ isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change.");
export class UpdateProductDto extends createZodDto(updateProductSchema) {}

// Product photo upload: presigned PUT straight to storage, then attach (same flow as attachments, ADR-008).

export const productImageUploadSchema = z.object({
  contentType: z.enum(PRODUCT_IMAGE_MIME),
  contentLength: z.number().int().positive().max(PRODUCT_IMAGE_MAX_BYTES, "Images can be up to 5 MB."),
});
export class ProductImageUploadDto extends createZodDto(productImageUploadSchema) {}

export const productImageUploadResponseSchema = z.object({
  key: z.string().describe("Send back to PUT /products/{sku}/image once the upload finishes"),
  uploadUrl: z.string().url(),
  method: z.literal("PUT"),
  headers: z.record(z.string()),
  expiresAt: z.string().datetime(),
});
export type ProductImageUploadResponse = z.infer<typeof productImageUploadResponseSchema>;
export class ProductImageUploadResponseDto extends createZodDto(productImageUploadResponseSchema) {}

export const attachProductImageSchema = z.object({ key: z.string().min(1).max(200) });
export class AttachProductImageDto extends createZodDto(attachProductImageSchema) {}
