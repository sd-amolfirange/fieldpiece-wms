import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { addressSchema, csvEnum, serialNumber } from "../../common/validation/schemas";
import { RMA_ACTIONS, RMA_STATUSES, RMA_TYPES } from "./rma-state-machine";

export const rmaSchema = z.object({
  id: z.string().uuid(),
  displayNo: z.string().describe("e.g. RMA-000045"),
  claimId: z.string().uuid(),
  claimDisplayNo: z.string(),
  serialNumber: z.string(),
  sku: z.string(),
  productName: z.string(),
  type: z.enum(RMA_TYPES),
  status: z.enum(RMA_STATUSES),
  serviceCenter: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  shipTo: addressSchema.partial().describe("Where the customer sends the unit"),
  returnAddress: addressSchema.partial().nullable().describe("Where the repaired / replacement unit goes"),
  inboundCarrier: z.string().nullable(),
  inboundTracking: z.string().nullable(),
  outboundCarrier: z.string().nullable(),
  outboundTracking: z.string().nullable(),
  inspectionNotes: z.string().nullable(),
  rootCause: z.string().nullable(),
  partsUsed: z.array(z.string()),
  replacementSerial: z.string().nullable(),
  creditAmount: z.string().nullable().describe("Decimal as a string, e.g. 249.00"),
  creditCurrency: z.string().nullable(),
  completedAt: z.string().datetime().nullable(),
  version: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  allowedActions: z.array(z.enum(RMA_ACTIONS as [string, ...string[]])),
});
export type RmaResponse = z.infer<typeof rmaSchema>;
export class RmaDto extends createZodDto(rmaSchema) {}
export class RmaPageDto extends createZodDto(paginatedSchema(rmaSchema.omit({ allowedActions: true }))) {}

export class RmaListQueryDto extends createZodDto(
  pageQuerySchema.extend({ status: csvEnum([...RMA_STATUSES]).optional() }),
) {}

const tracking = z.string().trim().min(4).max(40);
const carrier = z
  .string()
  .trim()
  .max(30)
  .optional()
  .describe("Auto-detected from the tracking number when omitted");

export class ShipInboundDto extends createZodDto(z.object({ trackingNumber: tracking, carrier })) {}
export class ReceiveDto extends createZodDto(z.object({ note: z.string().trim().max(2000).optional() })) {}

export const ROOT_CAUSES = [
  "component_failure",
  "firmware",
  "calibration",
  "physical_damage",
  "water_damage",
  "no_fault_found",
  "other",
] as const;

export class InspectDto extends createZodDto(
  z.object({
    findings: z.string().trim().min(10, "Describe what you found.").max(5000),
    rootCause: z.enum(ROOT_CAUSES),
    partsUsed: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  }),
) {}

export class CompleteDto extends createZodDto(
  z.object({
    outboundTracking: tracking.optional(),
    outboundCarrier: carrier,
    replacementSerial: serialNumber.optional().describe("Required for replace"),
    creditAmount: z.number().positive().max(1_000_000).optional().describe("Required for credit"),
    creditCurrency: z.string().length(3).toUpperCase().optional(),
  }),
) {}

export class CancelDto extends createZodDto(z.object({ reason: z.string().trim().min(5).max(1000) })) {}
