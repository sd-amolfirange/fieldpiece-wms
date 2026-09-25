import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isoDateString, uuid } from "../../common/validation/schemas";
import { PRODUCT_FAMILIES } from "../products";

export const reportFiltersSchema = z
  .object({
    from: isoDateString.optional().describe("Default: 90 days ago"),
    to: isoDateString.optional().describe("Inclusive. Default: today"),
    sku: z.string().trim().toUpperCase().optional(),
    family: z.enum(PRODUCT_FAMILIES).optional(),
    region: z.string().trim().max(100).optional().describe("Customer state / province"),
    distributorId: uuid
      .optional()
      .describe("Agents and admins only; distributors are always scoped to their org"),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ["to"],
    message: "End date must be on or after the start date.",
  });
export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export class ReportFiltersDto extends createZodDto(reportFiltersSchema) {}

export const claimsSummarySchema = z.object({
  from: z.string(),
  to: z.string(),
  byStatus: z.array(z.object({ status: z.string(), count: z.number().int() })),
  claimsSubmitted: z.object({ current: z.number().int(), previous: z.number().int() }),
  registrations: z.object({ current: z.number().int(), previous: z.number().int() }),
  openClaims: z.number().int(),
  unassigned: z.number().int(),
  slaBreached: z.number().int(),
  avgResolutionDays: z.number().nullable(),
  claimsOverTime: z.array(z.object({ date: z.string(), count: z.number().int() })),
});
export type ClaimsSummary = z.infer<typeof claimsSummarySchema>;
export class ClaimsSummaryDto extends createZodDto(claimsSummarySchema) {}

export class ClaimRateDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        sku: z.string(),
        name: z.string(),
        registrations: z.number().int(),
        claims: z.number().int(),
        rate: z.number(),
      }),
    ),
  }),
) {}

export class FailureCategoriesDto extends createZodDto(
  z.object({
    items: z.array(z.object({ category: z.string(), label: z.string(), count: z.number().int() })),
  }),
) {}

export class ResolutionTimeDto extends createZodDto(
  z.object({ items: z.array(z.object({ week: z.string(), avgDays: z.number(), count: z.number().int() })) }),
) {}

export class CostDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        type: z.string(),
        count: z.number().int(),
        creditTotal: z.string().describe("Decimal string"),
        currency: z.string().nullable(),
      }),
    ),
  }),
) {}
