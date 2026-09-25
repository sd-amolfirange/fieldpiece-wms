import { Global, Module } from "@nestjs/common";
import { ClaimsModule, RmaIssuer } from "../claims";
import { RegistrationsModule } from "../registrations";
import { RmaController } from "./rma.controller";
import { RmaRepository } from "./rma.repository";
import { RmaIssuanceService, RmaService } from "./rma.service";

/**
 * Global only so ClaimsModule can inject the RmaIssuer port without importing this module
 * (which imports ClaimsModule for the claim side of the lifecycle).
 */
@Global()
@Module({
  imports: [ClaimsModule, RegistrationsModule],
  controllers: [RmaController],
  providers: [RmaService, RmaRepository, { provide: RmaIssuer, useClass: RmaIssuanceService }],
  exports: [RmaIssuer],
})
export class RmaModule {}
