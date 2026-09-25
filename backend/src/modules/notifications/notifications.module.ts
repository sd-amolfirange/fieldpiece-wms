import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { Notifier } from "./notifier.service";

@Module({
  controllers: [NotificationsController],
  providers: [Notifier],
  exports: [Notifier],
})
export class NotificationsModule {}
