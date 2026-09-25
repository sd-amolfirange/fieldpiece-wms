import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import { CreatePolicyDto, PolicyDto, PolicyListDto, PolicyListQueryDto, UpdatePolicyDto } from "./dto";
import { PoliciesService } from "./policies.service";

@ApiTags("policies")
@ApiBearerAuth("jwt")
@Controller("policies")
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  @Get()
  @Roles("claims_agent", "admin")
  @ApiOperation({
    summary: "List warranty policies",
    description: "Filter by SKU or by the date they're active on.",
  })
  @ApiOkResponse({ type: PolicyListDto })
  @ApiErrors()
  async list(@Query() query: PolicyListQueryDto) {
    return { items: await this.policies.list(query) };
  }

  @Post()
  @Roles("admin")
  @ApiOperation({
    summary: "Create a warranty policy",
    description: "Only one policy may be in effect per product (or for the default) at a time.",
  })
  @ApiCreatedResponse({ type: PolicyDto })
  @ApiErrors({ 409: [ErrorCode.POLICY_OVERLAP], 422: [ErrorCode.PRODUCT_NOT_FOUND] })
  create(@Ctx() ctx: RequestContext, @Body() body: CreatePolicyDto) {
    return this.policies.create(ctx, body);
  }

  @Patch(":id")
  @Roles("admin")
  @ApiOperation({
    summary: "Update a warranty policy",
    description: "Once registrations use a policy, only effectiveTo, coverage and exclusions can change.",
  })
  @ApiOkResponse({ type: PolicyDto })
  @ApiErrors({
    404: [ErrorCode.NOT_FOUND],
    409: [ErrorCode.POLICY_OVERLAP],
    422: [ErrorCode.VALIDATION_FAILED],
  })
  update(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdatePolicyDto) {
    return this.policies.update(ctx, id, body);
  }
}
