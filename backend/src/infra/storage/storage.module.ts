import { Global, Inject, Logger, Module, type OnModuleInit } from "@nestjs/common";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { BlobStorage } from "./blob-storage";
import { LocalBlobStorage } from "./local-blob-storage";
import { S3BlobStorage } from "./s3-blob-storage";

function createStorage(env: Env): BlobStorage {
  switch (env.STORAGE_DRIVER) {
    case "local":
      return new LocalBlobStorage(env.STORAGE_LOCAL_DIR);
    case "s3":
    case "minio":
      return new S3BlobStorage(env);
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

  /** Creates the local folder or the MinIO bucket in development. Production storage is provisioned. */
  async onModuleInit(): Promise<void> {
    if (this.env.NODE_ENV === "production" || this.env.STORAGE_DRIVER === "s3") return;
    try {
      await this.storage.ensureReady();
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, "Storage isn't reachable; uploads will fail until it is");
    }
  }
}
