import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { isoDateString } from "../../common/validation/schemas";

const listItem = z.string().trim().min(1).max(60);

export const policySchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid().nullable().describe("null = default policy for every product"),
  sku: z.string().nullable().describe("e.g. SC680"),
  baseMonths: z.number().int().describe("e.g. 36"),
  registrationBonusMonths: z.number().int(),
  registrationWindowDays: z.number().int().nullable(),
  coverage: z.array(z.string()).describe('e.g. ["manufacturing_defects"]'),
  exclusions: z.array(z.string()).describe('e.g. ["physical_damage", "misuse", "consumables"]'),
  effectiveFrom: z.string().describe("YYYY-MM-DD"),
  effectiveTo: z.string().nullable(),
  inUse: z.boolean().describe("True when registrations reference it; terms are then frozen"),
});
export type PolicyResponse = z.infer<typeof policySchema>;
export class PolicyDto extends createZodDto(policySchema) {}
export class PolicyListDto extends createZodDto(z.object({ items: z.array(policySchema) })) {}

export class PolicyListQueryDto extends createZodDto(
  z.object({ sku: z.string().trim().toUpperCase().optional(), activeOn: isoDateString.optional() }),
) {}

export const createPolicySchema = z
  .object({
    sku: z.string().trim().toUpperCase().nullable().describe("null for the default policy"),
    baseMonths: z.number().int().min(0).max(240),
    registrationBonusMonths: z.number().int().min(0).max(120).default(0),
    registrationWindowDays: z.number().int().min(0).max(3650).nullable().default(null),
    coverage: z.array(listItem).max(20).default([]),
    exclusions: z.array(listItem).max(20).default([]),
    effectiveFrom: isoDateString,
    effectiveTo: isoDateString.nullable().default(null),
  })
  .refine((v) => !v.effectiveTo || v.effectiveTo > v.effectiveFrom, {
    path: ["effectiveTo"],
    message: "Must be after the start date.",
  });
export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export class CreatePolicyDto extends createZodDto(createPolicySchema) {}

export const updatePolicySchema = z
  .object({
    baseMonths: z.number().int().min(0).max(240),
    registrationBonusMonths: z.number().int().min(0).max(120),
    registrationWindowDays: z.number().int().min(0).max(3650).nullable(),
    coverage: z.array(listItem).max(20),
    exclusions: z.array(listItem).max(20),
    effectiveFrom: isoDateString,
    effectiveTo: isoDateString.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change.");
export type UpdatePolicyInput = z.infer<typeof updatePolicySchema>;
export class UpdatePolicyDto extends createZodDto(updatePolicySchema) {}
