import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Brand, DealerView, ModelView, OrgStructure } from "@wms/domain";
import type { Ctx as RequestCtx } from "../../common/auth/context";
import { Ctx, Roles } from "../../common/auth/decorators";
import { CatalogService } from "./catalog.service";

@ApiTags("catalog")
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("models")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Models with their part templates", description: "A06 and every model picker." })
  @ApiOkResponse({ description: "ModelView[]" })
  models(): Promise<ModelView[]> {
    return this.catalog.models();
  }

  @Get("brands")
  @Roles("admin", "dealer", "distributor", "customer")
  @ApiOperation({ summary: "Brands" })
  @ApiOkResponse({ description: "Brand[]" })
  brands(): Promise<Brand[]> {
    return this.catalog.brands();
  }

  @Get("dealers")
  @Roles("admin", "dealer", "distributor")
  @ApiOperation({ summary: "Dealers the caller may see", description: "Admin: all; distributor: its dealers; dealer: itself." })
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
