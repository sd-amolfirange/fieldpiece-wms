import { z } from "zod";
import { DEFAULT_SERIAL_PATTERN } from "@/lib/serial";
import { normalizeSerial } from "@/lib/format";
import { validatePurchaseDate } from "@/lib/warranty";

const purchaseDateMessages = {
  required: "Enter the purchase date.",
  future: "Purchase date can't be in the future.",
  beforeLaunch: "Purchase date is before this product was released. Check the receipt.",
} as const;

export const registrationSchema = z
  .object({
    serialNumber: z
      .string()
      .transform(normalizeSerial)
      .pipe(
        z
          .string()
          .min(1, "Enter the serial number.")
          .regex(
            new RegExp(DEFAULT_SERIAL_PATTERN),
            "That doesn't look like a valid serial number. Check the label on the unit.",
          ),
      ),
    sku: z.string().min(1, "Pick the product."),
    launchDate: z.string().optional(), // from the selected product, used for validation only
    purchaseDate: z.string(),
    sellerName: z.string().trim().optional(),
    proofCount: z.number().int().min(1, "Upload the receipt or invoice."),
    ownerName: z.string().trim().min(1, "Enter the owner's name."),
    ownerEmail: z.string().trim().email("Enter a valid email, like name@company.com."),
    ownerPhone: z.string().trim().optional(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: "Accept the warranty terms to continue." }) }),
  })
  .superRefine((value, ctx) => {
    const problem = validatePurchaseDate(value.purchaseDate || null, { launchDate: value.launchDate });
    if (problem)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["purchaseDate"],
        message: purchaseDateMessages[problem],
      });
  });

export type RegistrationForm = z.input<typeof registrationSchema>;

/** Detect the SKU from a serial prefix where the pattern allows it (Section 8.3). [CONFIRM formats] */
export function detectSku(serial: string, skus: { sku: string; serialPattern?: string }[]): string | null {
  const normalized = normalizeSerial(serial);
  const match = skus.find((p) =>
    p.serialPattern ? new RegExp(p.serialPattern).test(normalized) : normalized.startsWith(`${p.sku}-`),
  );
  return match?.sku ?? null;
}
