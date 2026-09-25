import { Module } from "@nestjs/common";
import { PoliciesController } from "./policies.controller";
import { PoliciesRepository } from "./policies.repository";
import { PoliciesService } from "./policies.service";

@Module({
  controllers: [PoliciesController],
  providers: [PoliciesService, PoliciesRepository],
  exports: [PoliciesService],
})
export class PoliciesModule {}
