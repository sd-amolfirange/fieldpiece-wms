import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { serialNumber } from "../../common/validation/schemas";

export class WarrantyCheckQueryDto extends createZodDto(
  z.object({
    serial: serialNumber.describe("e.g. SC680-100037"),
    sku: z
      .string()
      .trim()
      .toUpperCase()
      .max(30)
      .optional()
      .describe("Disambiguates serials shared across products"),
  }),
) {}

/** Minimal public data only (Section 11.4): product, status, end date. */
export const warrantyCheckSchema = z.object({
  serialNumber: z.string(),
  product: z.object({
    sku: z.string().describe("e.g. SC680"),
    name: z.string(),
    family: z.string(),
    imageUrl: z.string().nullable(),
  }),
  registered: z.boolean(),
  warrantyStatus: z.enum(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "NOT_REGISTERED"]),
  warrantyEnd: z.string().nullable().describe("YYYY-MM-DD"),
});
export type WarrantyCheckResponse = z.infer<typeof warrantyCheckSchema>;
export class WarrantyCheckDto extends createZodDto(warrantyCheckSchema) {}
