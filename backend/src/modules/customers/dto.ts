import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { addressSchema, emailSchema } from "../../common/validation/schemas";

export const customerSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string().nullable().describe("e.g. Northside Heating & Air"),
  contactName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: addressSchema.partial(),
  distributorId: z.string().uuid().nullable(),
  hasLogin: z.boolean().describe("True when the customer is also a technician user"),
  createdAt: z.string().datetime(),
});
export type CustomerResponse = z.infer<typeof customerSchema>;
export class CustomerDto extends createZodDto(customerSchema) {}
export class CustomerPageDto extends createZodDto(paginatedSchema(customerSchema)) {}

export class CustomerListQueryDto extends createZodDto(pageQuerySchema) {}

/** Contact details reused by registration (new owner) and the customers endpoints. */
export const customerInputSchema = z.object({
  companyName: z.string().trim().max(160).nullable().optional(),
  contactName: z.string().trim().min(1, "Enter the owner's name.").max(160),
  email: emailSchema.nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  address: addressSchema,
});
export type CustomerInput = z.infer<typeof customerInputSchema>;

export class CreateCustomerDto extends createZodDto(
  customerInputSchema.extend({
    distributorId: z.string().uuid().nullable().optional().describe("Agents and admins only"),
  }),
) {}

export class UpdateCustomerDto extends createZodDto(
  customerInputSchema
    .partial()
    .refine((v) => Object.keys(v).length > 0, "Send at least one field to change."),
) {}
