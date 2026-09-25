import type { Readable } from "node:stream";

/** Object storage port (ADR-008). Adapters: S3-compatible (AWS S3, MinIO). Azure Blob is a TODO. */
export abstract class BlobStorage {
  /** Presigned PUT with content type and length pinned. */
  abstract presignPut(input: {
    key: string;
    contentType: string;
    contentLength: number;
    expiresInSeconds: number;
  }): Promise<{ url: string; headers: Record<string, string> }>;

  abstract presignGet(input: {
    key: string;
    expiresInSeconds: number;
    downloadName?: string;
  }): Promise<string>;

  abstract head(key: string): Promise<{ size: number; contentType: string | undefined } | null>;

  /** Reads the first `bytes` bytes (magic-byte sniffing). */
  abstract readStart(key: string, bytes: number): Promise<Buffer>;

  abstract getStream(key: string): Promise<Readable>;

  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;

  abstract delete(key: string): Promise<void>;

  /** Creates the bucket if missing. Local development only. */
  abstract ensureBucket(): Promise<void>;
}
