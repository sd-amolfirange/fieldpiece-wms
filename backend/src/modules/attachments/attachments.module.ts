import { Module } from "@nestjs/common";
import { AttachmentsController } from "./attachments.controller";
import { AttachmentsRepository } from "./attachments.repository";
import { AttachmentsService } from "./attachments.service";

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentsRepository],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
