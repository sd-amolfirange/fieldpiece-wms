import { Controller, Get, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { Roles } from "../../common/auth/decorators";
import { ApiErrors } from "../../common/http/swagger";
import { AuditService } from "./audit.service";

const auditQuery = z.object({
  entity: z.string().max(50).optional(),
  entityId: z.string().uuid().optional(),
  after: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => BigInt(v))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
class AuditQueryDto extends createZodDto(auditQuery) {}

const auditPage = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      occurredAt: z.string().datetime(),
      actorId: z.string().uuid().nullable(),
      actorIp: z.string().nullable(),
      action: z.string().describe("e.g. claim.status_changed"),
      entity: z.string(),
      entityId: z.string().uuid().nullable(),
      before: z.unknown(),
      after: z.unknown(),
      requestId: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
class AuditPageDto extends createZodDto(auditPage) {}

@ApiTags("audit")
@ApiBearerAuth("jwt")
@Controller("audit")
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles("admin")
  @ApiOperation({ summary: "Audit trail", description: "Newest first, keyset-paginated with `after`." })
  @ApiOkResponse({ type: AuditPageDto })
  @ApiErrors()
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
