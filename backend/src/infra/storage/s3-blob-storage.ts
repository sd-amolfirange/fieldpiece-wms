import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import type { Env } from "../../config/env";
import { BlobStorage } from "./blob-storage";

function client(env: Env, endpoint: string | undefined): S3Client {
  return new S3Client({
    region: env.STORAGE_REGION,
    endpoint,
    forcePathStyle: env.STORAGE_DRIVER === "minio",
    credentials:
      env.STORAGE_ACCESS_KEY && env.STORAGE_SECRET_KEY
        ? { accessKeyId: env.STORAGE_ACCESS_KEY, secretAccessKey: env.STORAGE_SECRET_KEY }
        : undefined,
    requestHandler: { requestTimeout: 5000 },
  });
}

/** AWS S3 and MinIO adapter. */
export class S3BlobStorage extends BlobStorage {
  private readonly s3: S3Client;
  /** Signs URLs against the browser-reachable endpoint (differs from the internal one in Docker). */
  private readonly signer: S3Client;
  private readonly bucket: string;

  constructor(env: Env) {
    super();
    this.bucket = env.STORAGE_BUCKET;
    this.s3 = client(env, env.STORAGE_ENDPOINT);
    this.signer = client(env, env.STORAGE_PUBLIC_ENDPOINT ?? env.STORAGE_ENDPOINT);
  }

  async presignPut({
    key,
    contentType,
    contentLength,
    expiresInSeconds,
  }: Parameters<BlobStorage["presignPut"]>[0]) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    });
    const url = await getSignedUrl(this.signer, command, {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(["content-type", "content-length"]),
    });
    return { url, headers: { "Content-Type": contentType } };
  }

  async presignGet({ key, expiresInSeconds, downloadName }: Parameters<BlobStorage["presignGet"]>[0]) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadName
        ? `attachment; filename="${downloadName.replace(/[^\w.\- ]/g, "_")}"`
        : undefined,
    });
    return getSignedUrl(this.signer, command, { expiresIn: expiresInSeconds });
  }

  async head(key: string) {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType };
    } catch (err) {
      if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return null;
      throw err;
    }
  }

  async readStart(key: string, bytes: number): Promise<Buffer> {
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  async getStream(key: string): Promise<Readable> {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!(res.Body instanceof Readable)) throw new Error("Unexpected S3 body type");
    return res.Body;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }
}
