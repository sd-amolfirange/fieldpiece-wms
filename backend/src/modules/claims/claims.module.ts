import { Module } from "@nestjs/common";
import { AttachmentsModule } from "../attachments";
import { RegistrationsModule } from "../registrations";
import { ClaimsController } from "./claims.controller";
import { ClaimsRepository } from "./claims.repository";
import { ClaimsService } from "./claims.service";
import { FailureCategoriesController } from "./failure-categories.controller";
import { SlaService } from "./sla.service";

/** RmaIssuer is provided globally by RmaModule (see rma-issuer.port.ts). */
@Module({
  imports: [RegistrationsModule, AttachmentsModule],
  controllers: [ClaimsController, FailureCategoriesController],
  providers: [ClaimsService, ClaimsRepository, SlaService],
  exports: [ClaimsService, SlaService],
})
export class ClaimsModule {}
