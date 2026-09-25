import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ROLES } from "../../common/auth/roles";
import { pageQuerySchema, paginatedSchema } from "../../common/pagination/pagination";
import { emailSchema } from "../../common/validation/schemas";
import { PERMISSIONS } from "./permissions";

const roleEnum = z.enum(ROLES);

export const meSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().describe("e.g. sam.tech@example.com"),
  displayName: z.string(),
  roles: z.array(roleEnum),
  primaryRole: roleEnum.nullable().describe("Most privileged role, for UIs that need one"),
  organization: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.enum(["fieldpiece", "distributor", "service_center"]),
    })
    .nullable(),
  currency: z.string().length(3).describe("ISO 4217, e.g. USD"),
  permissions: z.array(z.enum(PERMISSIONS)),
});
export class MeDto extends createZodDto(meSchema) {}

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  roles: z.array(roleEnum),
  organizationId: z.string().uuid().nullable(),
  organizationName: z.string().nullable(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type UserResponse = z.infer<typeof userSchema>;
export class UserDto extends createZodDto(userSchema) {}
export class UserPageDto extends createZodDto(paginatedSchema(userSchema)) {}

export class UserListQueryDto extends createZodDto(
  pageQuerySchema.extend({ role: roleEnum.optional(), active: z.enum(["true", "false"]).optional() }),
) {}

export const createUserSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(120),
  roles: z.array(roleEnum).min(1, "Pick at least one role."),
  organizationId: z.string().uuid().nullable().optional(),
});
export class CreateUserDto extends createZodDto(createUserSchema) {}

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120),
    roles: z.array(roleEnum).min(1, "Pick at least one role."),
    organizationId: z.string().uuid().nullable(),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Send at least one field to change.");
export class UpdateUserDto extends createZodDto(updateUserSchema) {}
