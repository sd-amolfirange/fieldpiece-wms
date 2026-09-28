import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog";
import { FilesModule } from "../files";
import { IntegrationsModule } from "../integrations";
import { RegistrationsModule } from "../registrations";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";
import { PartnerClientsService } from "./partner-clients.service";

@Module({
  imports: [CatalogModule, FilesModule, IntegrationsModule, RegistrationsModule],
  controllers: [IntakeController],
  providers: [IntakeService, PartnerClientsService],
  exports: [IntakeService, PartnerClientsService],
})
export class IntakeModule {}
