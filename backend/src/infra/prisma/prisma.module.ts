import { Global, Module } from "@nestjs/common";
import { PrismaService, ReplicaPrismaService } from "./prisma.service";

@Global()
@Module({
  providers: [PrismaService, ReplicaPrismaService],
  exports: [PrismaService, ReplicaPrismaService],
})
export class PrismaModule {}
