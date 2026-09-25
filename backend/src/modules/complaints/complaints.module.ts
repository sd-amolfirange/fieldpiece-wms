import { Module } from "@nestjs/common";
import { ClaimsModule } from "../claims";
import { FilesModule } from "../files";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { UnitsModule } from "../units";
import { ComplaintsController } from "./complaints.controller";
import { ComplaintsService } from "./complaints.service";

@Module({
  imports: [ClaimsModule, FilesModule, IntegrationsModule, NotificationsModule, UnitsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
