import { isIsoDate, normalizeSerialValue, SERIAL_PATTERN, todayIso } from "@wms/domain";
import { z } from "zod";

// Form rules for DL03 and CU01. Messages are i18n keys, translated where they're shown.

const serial = z
  .string()
  .transform(normalizeSerialValue)
  .pipe(z.string().min(1, "validation.required").regex(SERIAL_PATTERN, "validation.serial"));

const pastDate = (requiredKey: string) =>
  z
    .string()
    .min(1, requiredKey)
    .refine((v) => isIsoDate(v), "validation.date")
    .refine((v) => v <= todayIso(), "rowErrors.future_date");

/** CU01: the customer registers a unit they bought (serial and model come from the QR label). */
export const selfRegisterSchema = z.object({
  serial,
  modelCode: z.string().min(1, "validation.pickModel"),
  purchaseDate: pastDate("validation.required"),
  location: z.string().trim().optional(),
  invoiceCount: z.number().int().min(1, "validation.invoiceRequired"),
});
export type SelfRegisterForm = z.input<typeof selfRegisterSchema>;

/** DL03: a dealer (or a distributor / admin, who must pick the dealer) registers a unit at installation. */
export const unitRegisterSchema = (needsDealer: boolean) =>
  z
    .object({
      serial,
      modelCode: z.string().min(1, "validation.pickModel"),
      dealerId: z.string().optional(),
      installDate: pastDate("rowErrors.required"),
      location: z.string().trim().optional(),
      invoiceNumber: z.string().trim().optional(),
      customerName: z.string().trim().min(1, "rowErrors.required"),
      customerPhone: z.string().trim().min(1, "rowErrors.required"),
      customerEmail: z.union([z.literal(""), z.string().trim().email("validation.email")]).optional(),
      city: z.string().trim().optional(),
    })
    .superRefine((value, ctx) => {
      if (needsDealer && !value.dealerId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dealerId"], message: "validation.pickDealer" });
      }
    });
export type UnitRegisterForm = z.input<ReturnType<typeof unitRegisterSchema>>;
