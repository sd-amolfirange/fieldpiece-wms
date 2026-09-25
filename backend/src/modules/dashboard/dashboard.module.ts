import { Module } from "@nestjs/common";
import { CatalogModule } from "../catalog";
import { UnitsModule } from "../units";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [CatalogModule, UnitsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
