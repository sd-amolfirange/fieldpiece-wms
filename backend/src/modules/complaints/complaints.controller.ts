import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { COMPLAINT_SOURCES, COMPLAINT_STATUSES, type ComplaintView, type Paginated } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import type { RawQuery } from "../../common/http/list-query";
import { ComplaintsService } from "./complaints.service";

const ALL = ["admin", "dealer", "distributor", "customer"] as const;

@ApiTags("complaints")
@Controller("complaints")
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @Roles(...ALL)
  @ApiOperation({
    summary: "Complaints in the caller's scope (A07, DL07, CU05)",
    description: "`q` matches id, serial, customer and dealer. Newest first by default.",
  })
  @ApiQuery({ name: "status", required: false, enum: COMPLAINT_STATUSES })
  @ApiQuery({ name: "source", required: false, enum: COMPLAINT_SOURCES })
  @ApiOkResponse({ description: "Paginated<ComplaintView>" })
  list(@Ctx() ctx: RequestCtx, @Query() query: RawQuery): Promise<Paginated<ComplaintView>> {
    return this.complaints.list(ctx, query);
  }

  @Get(":id")
  @Roles(...ALL)
  @ApiOperation({ summary: "Complaint with entitlement, job result and claim status (A08, CU05)" })
  @ApiOkResponse({ description: "ComplaintView" })
  get(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<ComplaintView> {
    return this.complaints.get(ctx, id);
  }

  @Post()
  @HttpCode(200)
  @Roles(...ALL)
  @ApiOperation({
    summary: "Raise a complaint (CU04, DL06)",
    description:
      "The source follows the caller's role; the server decides the entitlement. `422` validation.describeFault; " +
      "`409 not_registered`; `404` for a unit outside the caller's scope.",
  })
  @ApiBody({
    schema: {
      type: "object",
      required: ["unitSerial", "description"],
      properties: {
        unitSerial: { type: "string" },
        description: { type: "string", minLength: 5 },
        attachmentIds: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiOkResponse({ description: "ComplaintView" })
  create(@Ctx() ctx: RequestCtx, @Body() body: unknown): Promise<ComplaintView> {
    return this.complaints.create(ctx, body ?? {});
  }

  @Post(":id/send-to-service")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Send to the service system (A08)",
    description: "NEW -> WITH_SERVICE; writes the outbound service request. `409 already_sent`.",
  })
  @ApiOkResponse({ description: "ComplaintView" })
  sendToService(@Ctx() ctx: RequestCtx, @Param("id") id: string): Promise<ComplaintView> {
    return this.complaints.sendToService(ctx, id);
  }
}
