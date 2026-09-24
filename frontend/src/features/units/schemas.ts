import { VOID_REASONS } from "@wms/domain";
import { z } from "zod";

// A05 Void warranty: a reason is required, the note is optional. Messages are i18n keys.
export const voidWarrantySchema = z.object({
  reason: z.enum(VOID_REASONS, { errorMap: () => ({ message: "validation.voidReason" }) }),
  note: z.string().trim().max(500).optional(),
});
export type VoidWarrantyForm = z.input<typeof voidWarrantySchema>;
