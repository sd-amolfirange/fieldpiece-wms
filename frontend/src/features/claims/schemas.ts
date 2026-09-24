import { z } from "zod";

// A10 claim actions: what the admin must enter before submitting or rejecting. Messages are i18n keys.
export const submitClaimSchema = z.object({
  rmaNumber: z.string().trim().optional(),
  amount: z.string().refine((v) => Number(v) > 0, "validation.amount"),
});
export type SubmitClaimForm = z.infer<typeof submitClaimSchema>;

export const rejectClaimSchema = z.object({ reason: z.string().trim().min(5, "validation.reasonRequired") });
export type RejectClaimForm = z.infer<typeof rejectClaimSchema>;
