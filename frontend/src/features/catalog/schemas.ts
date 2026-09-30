import { z } from "zod";

// A06 model finance: prices and the warranty quota. Money in the account currency, 2 decimals. Messages are i18n keys.
const money = z.coerce
  .number({ invalid_type_error: "validation.amount" })
  .min(0, "validation.amount")
  .max(1_000_000, "validation.amount")
  .refine((n) => Math.round(n * 100) === n * 100, "validation.amount");

export const modelFinanceSchema = z.object({
  listPrice: money,
  repairCost: money,
  warrantyBudget: money,
  claimQuota: z.coerce
    .number({ invalid_type_error: "validation.quota" })
    .int("validation.quota")
    .min(0, "validation.quota")
    .max(10_000, "validation.quota"),
});
export type ModelFinanceForm = z.input<typeof modelFinanceSchema>;
