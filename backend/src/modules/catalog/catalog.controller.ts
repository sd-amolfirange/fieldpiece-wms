import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
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
  models(): Promise<ModelView[]> {
    return this.catalog.models();
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
