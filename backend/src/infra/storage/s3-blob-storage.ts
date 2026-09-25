import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import type { Env } from "../../config/env";
import { BlobStorage } from "./blob-storage";

/** AWS S3 and MinIO adapter. The API streams files to and from the bucket; browsers never talk to it. */
export class S3BlobStorage extends BlobStorage {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(env: Env) {
    super();
    this.bucket = env.STORAGE_BUCKET;
    this.s3 = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_DRIVER === "minio",
      credentials:
        env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY
          ? { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY }
          : undefined,
      requestHandler: { requestTimeout: 10_000 },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getStream(key: string): Promise<Readable | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!(res.Body instanceof Readable)) throw new Error("Unexpected S3 body type");
      return res.Body;
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ensureReady(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}
