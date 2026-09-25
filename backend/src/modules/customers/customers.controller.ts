import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import {
  CreateCustomerDto,
  CustomerDto,
  CustomerListQueryDto,
  CustomerPageDto,
  UpdateCustomerDto,
} from "./dto";
import { CustomersService } from "./customers.service";

@ApiTags("customers")
@ApiBearerAuth("jwt")
@Roles("distributor", "claims_agent", "admin")
@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: "List customers", description: "Distributors see only their own customers." })
  @ApiOkResponse({ type: CustomerPageDto })
  @ApiErrors()
  list(@Ctx() ctx: RequestContext, @Query() query: CustomerListQueryDto) {
    return this.customers.list(ctx.user, query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a customer" })
  @ApiOkResponse({ type: CustomerDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  get(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.customers.get(ctx.user, id);
  }

  @Post()
  @ApiOperation({ summary: "Add a customer" })
  @ApiCreatedResponse({ type: CustomerDto })
  @ApiErrors()
  create(@Ctx() ctx: RequestContext, @Body() body: CreateCustomerDto) {
    return this.customers.create(ctx, body);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a customer" })
  @ApiOkResponse({ type: CustomerDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  update(
    @Ctx() ctx: RequestContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(ctx, id, body);
  }
}
