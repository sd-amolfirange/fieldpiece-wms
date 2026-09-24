import { z } from "zod";

// CU04 / DL06 / admin: messages are i18n keys, translated where they're shown.
export const complaintSchema = z.object({
  unitSerial: z.string().min(1, "validation.pickUnit"),
  description: z.string().trim().min(5, "validation.describeFault"),
});
export type ComplaintForm = z.input<typeof complaintSchema>;
