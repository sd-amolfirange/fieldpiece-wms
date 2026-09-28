import { Module } from "@nestjs/common";
import { IntakeModule } from "../intake";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { RegistrationsModule } from "../registrations";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";

@Module({
  imports: [IntakeModule, IntegrationsModule, NotificationsModule, RegistrationsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
