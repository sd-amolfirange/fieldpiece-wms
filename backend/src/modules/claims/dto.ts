import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ROLES } from "../../common/auth/roles";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { addressSchema, csvEnum, isoDateString, serialNumber, uuid } from "../../common/validation/schemas";
import { attachmentSchema } from "../attachments";
import { CLAIM_ENDPOINT_ACTIONS } from "./claim-state-machine";

export const CLAIM_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "RMA_ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
  "REPAIRED",
  "REPLACED",
  "CREDITED",
  "CLOSED",
] as const;

const resolution = z.enum(["repair", "replace", "credit"]);
const person = z.object({ id: z.string().uuid(), name: z.string() });

export const claimSummarySchema = z.object({
  id: z.string().uuid(),
  displayNo: z.string().describe("e.g. CLM-000123"),
  registrationId: z.string().uuid(),
  serialNumber: z.string(),
  sku: z.string(),
  productName: z.string(),
  failureCategory: z.string().describe("e.g. inaccurate_reading"),
  status: z.enum(CLAIM_STATUSES),
  inWarranty: z.boolean(),
  assignee: person.nullable(),
  slaDueAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int(),
});
export type ClaimSummary = z.infer<typeof claimSummarySchema>;
export class ClaimPageDto extends createZodDto(paginatedSchema(claimSummarySchema)) {}

export const claimDetailSchema = claimSummarySchema.extend({
  description: z.string(),
  failureDate: z.string(),
  preferredResolution: resolution.nullable(),
  resolution: z.enum(["repair", "replace", "credit", "none"]).nullable(),
  rejectionReason: z.string().nullable(),
  returnAddress: addressSchema.partial().nullable(),
  customerName: z.string(),
  createdBy: person,
  warranty: z.object({
    status: z.enum(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID"]),
    warrantyEnd: z.string(),
  }),
  rma: z
    .object({ id: z.string().uuid(), displayNo: z.string(), status: z.string(), type: resolution })
    .nullable(),
  attachments: z.array(attachmentSchema),
  allowedActions: z.array(z.enum(CLAIM_ENDPOINT_ACTIONS)).describe("Actions the caller may take now"),
});
export type ClaimDetail = z.infer<typeof claimDetailSchema>;
export class ClaimDetailDto extends createZodDto(claimDetailSchema) {}

export const claimEventSchema = z.object({
  id: z.string(),
  at: z.string().datetime(),
  actor: z.object({ id: z.string().uuid(), name: z.string(), role: z.enum(ROLES).nullable() }),
  type: z.enum(["created", "status_changed", "comment", "attachment_added", "assigned"]),
  fromStatus: z.enum(CLAIM_STATUSES).nullable(),
  toStatus: z.enum(CLAIM_STATUSES).nullable(),
  comment: z.string().nullable(),
  internal: z.boolean(),
});
export type ClaimEventResponse = z.infer<typeof claimEventSchema>;
export class ClaimEventDto extends createZodDto(claimEventSchema) {}
export class ClaimEventPageDto extends createZodDto(
  z.object({ items: z.array(claimEventSchema), nextCursor: z.string().nullable() }),
) {}

export class ClaimListQueryDto extends createZodDto(
  pageQuerySchema.extend({
    status: csvEnum([...CLAIM_STATUSES])
      .optional()
      .describe("Comma-separated, e.g. SUBMITTED,IN_REVIEW"),
    assignedTo: z.union([z.enum(["me", "unassigned"]), uuid]).optional(),
    displayNo: z.string().trim().toUpperCase().optional(),
    registrationId: uuid.optional(),
  }),
) {}

export class ClaimEventsQueryDto extends createZodDto(
  z.object({
    after: z.string().regex(/^\d+$/).optional().describe("Cursor: the last event id you have"),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
) {}

const claimFields = z.object({
  failureCategory: z.string().trim().min(1, "Pick what went wrong."),
  failureDate: isoDateString,
  description: z
    .string()
    .trim()
    .min(30, "Describe the problem in at least 30 characters so the reviewer can act on it.")
    .max(5000),
  preferredResolution: resolution.nullable().optional(),
  returnAddress: addressSchema.nullable().optional(),
  attachmentIds: z.array(uuid).max(5).default([]),
});

export const createClaimSchema = claimFields
  .extend({
    registrationId: uuid.optional(),
    serialNumber: serialNumber.optional().describe("Alternative to registrationId"),
  })
  .refine((v) => Boolean(v.registrationId) !== Boolean(v.serialNumber), {
    path: ["serialNumber"],
    message: "Pick a registered unit or enter its serial number.",
  });
export type CreateClaimInput = z.infer<typeof createClaimSchema>;
export class CreateClaimDto extends createZodDto(createClaimSchema) {}

export const updateClaimSchema = claimFields
  .partial()
  .refine(
    (v) => Object.keys(v).some((k) => k !== "attachmentIds" || (v.attachmentIds?.length ?? 0) > 0),
    "Send at least one field to change.",
  );
export type UpdateClaimInput = z.infer<typeof updateClaimSchema>;
export class UpdateClaimDto extends createZodDto(updateClaimSchema) {}

export class MessageDto extends createZodDto(
  z.object({ message: z.string().trim().min(1, "Write a message.").max(5000) }),
) {}
export class OptionalMessageDto extends createZodDto(
  z.object({ message: z.string().trim().max(5000).optional() }),
) {}

export class ApproveClaimDto extends createZodDto(
  z.object({ resolution, comment: z.string().trim().max(5000).optional() }),
) {}

export const REJECTION_REASONS = [
  "out_of_warranty",
  "physical_damage",
  "misuse",
  "no_fault_found",
  "missing_proof_of_purchase",
  "other",
] as const;

export class RejectClaimDto extends createZodDto(
  z.object({
    reason: z.enum(REJECTION_REASONS),
    message: z.string().trim().min(10, "Write a message to the customer explaining the decision.").max(5000),
  }),
) {}

export class AssignClaimDto extends createZodDto(z.object({ assigneeId: uuid.nullable() })) {}

export class CommentDto extends createZodDto(
  z.object({
    comment: z.string().trim().min(1, "Write a comment.").max(5000),
    internal: z.boolean().default(false).describe("Staff only; never shown to customers"),
  }),
) {}
