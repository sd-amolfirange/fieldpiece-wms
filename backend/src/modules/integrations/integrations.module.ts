import { Module } from "@nestjs/common";
import { IntegrationLog } from "./integration-log.service";
import { IntegrationsController } from "./integrations.controller";

@Module({
  controllers: [IntegrationsController],
  providers: [IntegrationLog],
  exports: [IntegrationLog],
})
export class IntegrationsModule {}
