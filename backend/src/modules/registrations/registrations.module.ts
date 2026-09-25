import { Module } from "@nestjs/common";
import { AttachmentsModule } from "../attachments";
import { CustomersModule } from "../customers";
import { PoliciesModule } from "../policies";
import { ProductsModule } from "../products";
import { WarrantyModule } from "../warranty";
import { CertificateService } from "./certificate.service";
import { RegistrationImportService } from "./registration-import.service";
import { RegistrationsController } from "./registrations.controller";
import { RegistrationsRepository } from "./registrations.repository";
import { RegistrationsService } from "./registrations.service";

@Module({
  imports: [ProductsModule, PoliciesModule, CustomersModule, AttachmentsModule, WarrantyModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService, RegistrationsRepository, RegistrationImportService, CertificateService],
  exports: [RegistrationsService, RegistrationImportService, CertificateService],
})
export class RegistrationsModule {}
