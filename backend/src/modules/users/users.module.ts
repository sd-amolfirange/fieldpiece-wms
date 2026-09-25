import { Module } from "@nestjs/common";
import { AuthUserResolver } from "../../common/auth/auth-user-resolver";
import { UsersController } from "./users.controller";
import { UsersRepository } from "./users.repository";
import { UsersService } from "./users.service";

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository, { provide: AuthUserResolver, useExisting: UsersService }],
  exports: [UsersService, AuthUserResolver],
})
export class UsersModule {}
