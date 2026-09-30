import { Body, Controller, Get, Param, Patch } from "@nestjs/common";
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { DealerView, ModelView, OrgStructure, ProductCategory } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import { CatalogService } from "./catalog.service";

@ApiTags("catalog")
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("models")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({
    summary: "Fieldpiece product models",
    description: "A06 and every model picker, with warranty term and serial/batch formats.",
  })
  @ApiOkResponse({ description: "ModelView[]" })
  models(@Ctx() ctx: RequestCtx): Promise<ModelView[]> {
    return this.catalog.models(ctx.user.role === "admin");
  }

  @Patch("models/:id")
  @Roles("admin")
  @ApiOperation({
    summary: "Set a model's list price, repair cost and warranty quota (A06)",
    description:
      "Omitted fields keep their value. Amounts: 0 to 1,000,000 with up to 2 decimals (`422` validation.amount); " +
      "claimQuota: a whole number 0 to 10,000 (`422` validation.quota). `404` unknown model.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        listPrice: { type: "number", minimum: 0 },
        repairCost: { type: "number", minimum: 0 },
        warrantyBudget: { type: "number", minimum: 0 },
        claimQuota: { type: "integer", minimum: 0 },
      },
    },
  })
  @ApiOkResponse({ description: "ModelView" })
  updateModel(@Param("id") id: string, @Body() body: unknown): Promise<ModelView> {
    return this.catalog.updateModel(id, body ?? {});
  }

  @Get("categories")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Product categories" })
  @ApiOkResponse({ description: "ProductCategory[]" })
  categories(): Promise<ProductCategory[]> {
    return this.catalog.categories();
  }

  @Get("dealers")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({
    summary: "Dealers the caller may see",
    description: "Admin: all; distributor: its dealers; dealer: itself.",
  })
  @ApiOkResponse({ description: "DealerView[]" })
  dealers(@Ctx() ctx: RequestCtx): Promise<DealerView[]> {
    return this.catalog.dealers(ctx.user);
  }

  @Get("admin/org")
  @Roles("admin")
  @ApiOperation({ summary: "Distributor -> dealer hierarchy and user accounts (A11)" })
  @ApiOkResponse({ description: "OrgStructure" })
  org(): Promise<OrgStructure> {
    return this.catalog.org();
  }
}
