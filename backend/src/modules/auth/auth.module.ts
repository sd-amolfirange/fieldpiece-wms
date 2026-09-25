import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { SessionService } from "./session.service";

@Module({
  controllers: [AuthController],
  providers: [SessionService, AuthGuard],
  exports: [SessionService, AuthGuard],
})
export class AuthModule {}
