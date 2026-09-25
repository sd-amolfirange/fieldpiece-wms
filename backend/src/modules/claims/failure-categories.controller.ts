import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { ApiErrors } from "../../common/http/swagger";
import { CacheService } from "../../infra/redis/cache.service";
import { PrismaService } from "../../infra/prisma/prisma.service";

class FailureCategoryListDto extends createZodDto(
  z.object({
    items: z.array(z.object({ code: z.string(), label: z.string(), requiresPhoto: z.boolean() })),
  }),
) {}

/** Admin-editable lookup (Section 5.1), so the UI reads it instead of hard-coding the list. */
@ApiTags("claims")
@ApiBearerAuth("jwt")
@Controller("failure-categories")
export class FailureCategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Active failure categories", description: "Cached for 10 minutes." })
  @ApiOkResponse({ type: FailureCategoryListDto })
  @ApiErrors()
  async list() {
    const items = await this.cache.getOrSet("failure-categories", 600, () =>
      this.prisma.failureCategory.findMany({
        where: { isActive: true },
        select: { code: true, label: true, requiresPhoto: true },
        orderBy: { label: "asc" },
      }),
    );
    return { items };
  }
}
