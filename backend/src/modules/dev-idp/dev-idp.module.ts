import { type DynamicModule, Module } from "@nestjs/common";
import { UsersModule } from "../users";
import { DevIdpController } from "./dev-idp.controller";

@Module({})
export class DevIdpModule {
  /** Mounts the dev IdP routes only when enabled; otherwise an empty module. */
  static register(enabled: boolean): DynamicModule {
    return enabled
      ? { module: DevIdpModule, imports: [UsersModule], controllers: [DevIdpController] }
      : { module: DevIdpModule };
  }
}
