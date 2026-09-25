import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../../common/auth/decorators";
import { ErrorCode } from "../../common/errors/error-codes";
import { ApiErrors } from "../../common/http/swagger";
import { WarrantyCheckDto, WarrantyCheckQueryDto } from "./dto";
import { WarrantyService } from "./warranty.service";

@ApiTags("warranty")
@Controller("warranty")
export class WarrantyController {
  constructor(private readonly warranty: WarrantyService) {}

  @Get("check")
  @Public()
  // 20/min per IP here, plus the global 500/day per IP for public routes (Section 11.4).
  // TODO: CAPTCHA after 10 misses. [CONFIRM]
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: "Public warranty lookup",
    description: "Returns only product, status and end date. Rate-limited per IP.",
  })
  @ApiOkResponse({ type: WarrantyCheckDto })
  @ApiErrors({ 404: [ErrorCode.NOT_FOUND] }, { isPublic: true })
  check(@Query() query: WarrantyCheckQueryDto) {
    return this.warranty.check(query.serial, query.sku);
  }
}
