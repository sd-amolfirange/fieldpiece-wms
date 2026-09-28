import { ISSUE_TYPES, RESOLUTIONS } from "@wms/domain";
import { z } from "zod";

// Warranty claim forms. Messages are i18n keys, translated where they're shown.

/** File a claim (customer, dealer or warranty desk). */
export const claimSchema = z.object({
  unitSerial: z.string().min(1, "validation.pickUnit"),
  issueType: z.enum(ISSUE_TYPES, { errorMap: () => ({ message: "validation.issueType" }) }),
  description: z.string().trim().min(10, "validation.describeFault"),
});
export type ClaimForm = z.input<typeof claimSchema>;

/** Approve: how the claim will be settled; a credit needs its amount. */
export const approveClaimSchema = z
  .object({
    resolution: z.enum(RESOLUTIONS, { errorMap: () => ({ message: "validation.resolution" }) }),
    creditAmount: z.string().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    const amount = Number(v.creditAmount);
    if (v.resolution === "CREDIT" && !(Number.isFinite(amount) && amount > 0 && amount <= 100_000))
      ctx.addIssue({ code: "custom", path: ["creditAmount"], message: "validation.amount" });
  });
export type ApproveClaimForm = z.input<typeof approveClaimSchema>;

export const rejectClaimSchema = z.object({ reason: z.string().trim().min(5, "validation.reasonRequired") });
export type RejectClaimForm = z.infer<typeof rejectClaimSchema>;

/** Close: a replacement needs the serial (and batch) of the product sent out. */
export const closeClaimSchema = (needsReplacement: boolean) =>
  z.object({
    replacementSerial: needsReplacement
      ? z.string().trim().min(1, "validation.required")
      : z.string().trim().optional(),
    replacementBatchNumber: z.string().trim().optional(),
    note: z.string().trim().max(2000).optional(),
  });
export type CloseClaimForm = z.input<ReturnType<typeof closeClaimSchema>>;
