import { Module } from "@nestjs/common";
import { ClaimsModule } from "../claims";
import { ComplaintsModule } from "../complaints";
import { FilesModule } from "../files";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { RegistrationsModule } from "../registrations";
import { DemoController } from "./demo.controller";
import { DemoService } from "./demo.service";

@Module({
  imports: [ClaimsModule, ComplaintsModule, FilesModule, IntegrationsModule, NotificationsModule, RegistrationsModule],
  controllers: [DemoController],
  providers: [DemoService],
})
export class DemoModule {}
