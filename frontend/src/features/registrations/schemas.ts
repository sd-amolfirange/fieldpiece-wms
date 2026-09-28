import { isIsoDate, normalizeBatchValue, normalizeSerialValue, SERIAL_PATTERN, todayIso } from "@wms/domain";
import { z } from "zod";

// Form rules for DL03, CU01 and the public web form. Messages are i18n keys, translated where they're shown.
// The server checks serial and batch against the model's own label format.

const serial = z
  .string()
  .transform(normalizeSerialValue)
  .pipe(z.string().min(1, "validation.required").regex(SERIAL_PATTERN, "validation.serial"));

const batch = z.string().transform(normalizeBatchValue);

const pastDate = (requiredKey: string) =>
  z
    .string()
    .min(1, requiredKey)
    .refine((v) => isIsoDate(v), "validation.date")
    .refine((v) => v <= todayIso(), "rowErrors.future_date");

const usState = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => !v || /^[A-Z]{2}$/.test(v), "validation.state")
  .optional();

const usZip = z
  .string()
  .trim()
  .refine((v) => !v || /^\d{5}(-\d{4})?$/.test(v), "validation.zip")
  .optional();

/** CU01: the customer registers a product they bought (serial, model and batch come from the QR label). */
export const selfRegisterSchema = z.object({
  serial,
  batchNumber: batch.optional(),
  modelCode: z.string().min(1, "validation.pickModel"),
  purchaseDate: pastDate("validation.required"),
  placeOfPurchase: z.string().trim().optional(),
  invoiceCount: z.number().int().min(1, "validation.invoiceRequired"),
});
export type SelfRegisterForm = z.input<typeof selfRegisterSchema>;

/** DL03: a dealer (or a distributor / admin, who must pick the dealer) registers a product it sold. */
export const unitRegisterSchema = (needsDealer: boolean) =>
  z
    .object({
      serial,
      batchNumber: batch.pipe(z.string().min(1, "rowErrors.required")),
      modelCode: z.string().min(1, "validation.pickModel"),
      dealerId: z.string().optional(),
      purchaseDate: pastDate("rowErrors.required"),
      invoiceNumber: z.string().trim().optional(),
      customerName: z.string().trim().min(1, "rowErrors.required"),
      customerPhone: z.string().trim().min(1, "rowErrors.required"),
      customerEmail: z.union([z.literal(""), z.string().trim().email("validation.email")]).optional(),
      city: z.string().trim().optional(),
      state: usState,
      zip: usZip,
    })
    .superRefine((value, ctx) => {
      if (needsDealer && !value.dealerId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dealerId"], message: "validation.pickDealer" });
      }
    });
export type UnitRegisterForm = z.input<ReturnType<typeof unitRegisterSchema>>;

/** Public web form: anyone who bought a product registers it with a proof of purchase; reviewed by the desk. */
export const publicRegisterSchema = z.object({
  serial,
  batchNumber: batch.optional(),
  modelCode: z.string().min(1, "validation.pickModel"),
  purchaseDate: pastDate("validation.required"),
  placeOfPurchase: z.string().trim().optional(),
  invoiceNumber: z.string().trim().optional(),
  customerName: z.string().trim().min(1, "validation.required"),
  customerEmail: z.string().trim().email("validation.email"),
  customerPhone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: usState,
  zip: usZip,
  website: z.string().optional(),
  invoiceCount: z.number().int().min(1, "validation.invoiceRequired"),
});
export type PublicRegisterForm = z.input<typeof publicRegisterSchema>;
