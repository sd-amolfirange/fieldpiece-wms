import { Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { RegistrationView } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Public, Roles } from "../../common/auth/decorators";
import { DemoService } from "./demo.service";

/** Mounted only when DEMO_FEATURES_ENABLED=true (never in production). */
@ApiTags("demo")
@Controller()
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get("auth/demo-accounts")
  @Public()
  @ApiOperation({
    summary: "Demo only: accounts for the sign-in page's picker",
    description: "Not mounted in production.",
  })
  @ApiOkResponse({ description: "`{ email, label, password }[]`" })
  accounts() {
    return this.demo.accounts();
  }

  @Post("simulate/reset")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: replace all data with the starting data, dated from today" })
  @ApiOkResponse({ description: "`{ ok: true }`" })
  reset(@Ctx() ctx: RequestCtx) {
    return this.demo.reset(ctx);
  }

  @Post("simulate/erp-invoice")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Demo only: a distributor ERP invoice with 3 new serials" })
  @ApiOkResponse({ description: "RegistrationView[]" })
  erpInvoice(@Ctx() ctx: RequestCtx): Promise<RegistrationView[]> {
    return this.demo.erpInvoice(ctx);
  }

  @Post("simulate/registration-email")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Demo only: a registration email with the invoice attached (through the email intake)",
  })
  @ApiOkResponse({ description: "RegistrationView" })
  registrationEmail(@Ctx() ctx: RequestCtx): Promise<RegistrationView> {
    return this.demo.registrationEmail(ctx);
  }

  @Post("simulate/marketplace-order")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Demo only: two online marketplace orders (through the partner API, channel RETAIL)",
  })
  @ApiOkResponse({ description: "RegistrationView[]" })
  marketplaceOrder(@Ctx() ctx: RequestCtx): Promise<RegistrationView[]> {
    return this.demo.marketplaceOrder(ctx);
  }

  @Post("simulate/joblink-registration")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary:
      "Demo only: a technician registers two new products from the Job Link app (partner API, channel JOBLINK)",
  })
  @ApiOkResponse({ description: "RegistrationView[]" })
  joblinkRegistration(@Ctx() ctx: RequestCtx): Promise<RegistrationView[]> {
    return this.demo.joblinkRegistration(ctx);
  }

  @Post("simulate/overwatch-registration")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({
    summary: "Demo only: a new product registered from the Overwatch app (partner API, channel OVERWATCH)",
  })
  @ApiOkResponse({ description: "RegistrationView[]" })
  overwatchRegistration(@Ctx() ctx: RequestCtx): Promise<RegistrationView[]> {
    return this.demo.overwatchRegistration(ctx);
  }
}
