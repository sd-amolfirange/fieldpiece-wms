import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { UnitsController } from "./units.controller";
import { UnitsRepository } from "./units.repository";
import { UnitsService } from "./units.service";

@Module({
  imports: [NotificationsModule, IntegrationsModule],
  controllers: [UnitsController],
  providers: [UnitsService, UnitsRepository],
  exports: [UnitsService, UnitsRepository],
})
export class UnitsModule {}
