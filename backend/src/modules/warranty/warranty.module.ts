import { Module } from "@nestjs/common";
import { WarrantyController } from "./warranty.controller";
import { WarrantyRepository } from "./warranty.repository";
import { WarrantyService } from "./warranty.service";

/** Lookup + calculation engine. Depends on no other domain module, so anyone can import the engine. */
@Module({
  controllers: [WarrantyController],
  providers: [WarrantyService, WarrantyRepository],
  exports: [WarrantyService],
})
export class WarrantyModule {}
