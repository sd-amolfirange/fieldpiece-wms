import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RequestContext } from "../../common/auth/auth-user";
import { Ctx, Roles } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import { CreateUserDto, MeDto, UpdateUserDto, UserDto, UserListQueryDto, UserPageDto } from "./dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth("jwt")
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  @ApiOperation({ summary: "Current user", description: "Profile, roles and display permissions." })
  @ApiOkResponse({ type: MeDto })
  @ApiErrors()
  me(@Ctx() ctx: RequestContext): Promise<MeDto> {
    return this.users.me(ctx.user);
  }

  @Get("users")
  @Roles("admin")
  @ApiOperation({ summary: "List users" })
  @ApiOkResponse({ type: UserPageDto })
  @ApiErrors()
  list(@Query() query: UserListQueryDto) {
    return this.users.list(query);
  }

  @Get("users/:id")
  @Roles("admin")
  @ApiOperation({ summary: "Get a user" })
  @ApiOkResponse({ type: UserDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @Post("users")
  @Roles("admin")
  @ApiOperation({
    summary: "Pre-provision a user",
    description: "The account is bound to the IdP identity on first sign-in with a verified matching email.",
  })
  @ApiCreatedResponse({ type: UserDto })
  @ApiErrors({ 409: [ErrorCode.CONFLICT] })
  create(@Ctx() ctx: RequestContext, @Body() body: CreateUserDto) {
    return this.users.create(ctx, body);
  }

  @Patch("users/:id")
  @Roles("admin")
  @ApiOperation({
    summary: "Change a user's roles, organisation or status",
    description: "Audited and alerted.",
  })
  @ApiOkResponse({ type: UserDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND], 422: [ErrorCode.VALIDATION_FAILED] })
  update(@Ctx() ctx: RequestContext, @Param("id", ParseUUIDPipe) id: string, @Body() body: UpdateUserDto) {
    return this.users.update(ctx, id, body);
  }
}
