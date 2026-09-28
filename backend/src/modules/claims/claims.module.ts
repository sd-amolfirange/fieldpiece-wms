import { Module } from "@nestjs/common";
import { FilesModule } from "../files";
import { IntegrationsModule } from "../integrations";
import { NotificationsModule } from "../notifications";
import { UnitsModule } from "../units";
import { ClaimsController } from "./claims.controller";
import { ClaimsService } from "./claims.service";

@Module({
  imports: [FilesModule, IntegrationsModule, NotificationsModule, UnitsModule],
  controllers: [ClaimsController],
  providers: [ClaimsService],
  exports: [ClaimsService],
})
export class ClaimsModule {}
