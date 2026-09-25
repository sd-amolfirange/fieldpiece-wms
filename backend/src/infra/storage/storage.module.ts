import { Global, Inject, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { BlobStorage } from "./blob-storage";
import { S3BlobStorage } from "./s3-blob-storage";

function createStorage(env: Env): BlobStorage {
  switch (env.STORAGE_DRIVER) {
    case "s3":
    case "minio":
      return new S3BlobStorage(env);
    case "azure":
      // TODO: Azure Blob adapter (@azure/storage-blob, user-delegation SAS) once the cloud is confirmed. [CONFIRM]
      throw new Error("STORAGE_DRIVER=azure is not implemented yet. Use s3 or minio.");
  }
}

@Global()
@Module({
  providers: [{ provide: BlobStorage, inject: [ENV], useFactory: createStorage }],
  exports: [BlobStorage],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger(StorageModule.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly storage: BlobStorage,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.env.STORAGE_DRIVER !== "minio" || this.env.NODE_ENV === "production") return;
    try {
      await this.storage.ensureBucket();
    } catch (err) {
      this.logger.warn(
        { err: (err as Error).message },
        "Couldn't reach MinIO; uploads will fail until it's up",
      );
    }
  }
}
