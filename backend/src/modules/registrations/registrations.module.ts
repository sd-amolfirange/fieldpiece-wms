import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog";
import { FilesModule } from "../files";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { UnitsModule } from "../units";
import { BulkImportsService } from "./bulk-imports.service";
import { BulkImportsController, RegistrationsController } from "./registrations.controller";
import { RegistrationsService } from "./registrations.service";

@Module({
  imports: [CatalogModule, FilesModule, IntegrationsModule, NotificationsModule, UnitsModule],
  controllers: [RegistrationsController, BulkImportsController],
  providers: [RegistrationsService, BulkImportsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
