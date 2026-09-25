import { Global, Module } from "@nestjs/common";
import { DevIdpKeys } from "./dev-idp-keys";
import { JwtVerifier } from "./jwt-verifier.service";

@Global()
@Module({
  providers: [DevIdpKeys, JwtVerifier],
  exports: [DevIdpKeys, JwtVerifier],
})
export class AuthModule {}
