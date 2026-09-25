import type { Readable } from "node:stream";

/** Object storage port. Adapters: local folder (development), S3-compatible (AWS S3, MinIO). */
export abstract class BlobStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  /** Null when the object doesn't exist. */
  abstract getStream(key: string): Promise<Readable | null>;

  abstract delete(key: string): Promise<void>;

  /** Creates the bucket or folder if missing. Development only. */
  abstract ensureReady(): Promise<void>;
}
