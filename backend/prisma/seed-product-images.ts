import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { matchesSignature } from "../src/common/files/file-signature";
import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIME,
  type ProductImageMime,
  productImageKey,
} from "../src/common/files/product-image";
import { loadDotEnv, loadEnv } from "../src/config/env";
import { S3BlobStorage } from "../src/infra/storage/s3-blob-storage";

// Loads the official product photos into object storage for the demo catalogue (development only).
// Needs internet access; kept apart from prisma/seed.ts so the main seed stays offline.
//
//   pnpm db:seed:images            # products that have no photo yet
//   pnpm db:seed:images --force    # replace every photo listed below
//
// Photos are Fieldpiece's own product images from fieldpiece.com, for development and demos. [CONFIRM] the
// production source (PIM, DAM or admin upload) with Fieldpiece. SKUs not listed have no official photo and
// show a placeholder until an admin uploads one.

const SOURCE = "https://resources.fieldpiece.com/wp-content/uploads";
const OFFICIAL_PHOTOS: Record<string, string> = {
  SC680: `${SOURCE}/2021/01/SC680-SRC-Product.png`,
  SC640: `${SOURCE}/2021/01/SC640-SRC-product.png`,
  SC440: `${SOURCE}/2021/01/SC440-SRC-product.png`,
  SC260: `${SOURCE}/2021/01/SC260-SRC-product.png`,
  JL3PR: `${SOURCE}/2021/01/JL3-Probes-470x470-02.png`,
  VP67: `${SOURCE}/2021/05/VP67.png`,
  MG44: `${SOURCE}/2021/05/MG44-Product.png`,
  MR45: `${SOURCE}/2020/11/MR45-v02.png`,
  DR82: `${SOURCE}/2021/05/DR82-Product.png`,
  DR58: `${SOURCE}/2021/05/DR58-Product.png`,
  CAT45: `${SOURCE}/2022/07/CAT45-470x470-01.png`,
  STA2: `${SOURCE}/2020/11/STA2-SRC-Product.png`,
  SDMN6: `${SOURCE}/2021/01/SDMN6-SRC-Product.png`,
  SPK3: `${SOURCE}/2021/01/SPK3-SRC-Product.png`,
  LT17A: `${SOURCE}/2021/01/LT17A-SRC-product.png`,
};

const FETCH_TIMEOUT_MS = 20_000;

/** Trusts the bytes, not the server's Content-Type. */
const sniff = (body: Buffer): ProductImageMime | undefined =>
  PRODUCT_IMAGE_MIME.find((mime) => matchesSignature(mime, body.subarray(0, 16)));

async function download(url: string): Promise<{ body: Buffer; mime: ProductImageMime }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > PRODUCT_IMAGE_MAX_BYTES) throw new Error(`too large (${body.length} bytes)`);
  const mime = sniff(body);
  if (!mime) throw new Error("not a PNG, JPEG or WebP image");
  return { body, mime };
}

async function main(): Promise<void> {
  loadDotEnv();
  const env = loadEnv();
  if (env.NODE_ENV === "production") throw new Error("Demo photos are for development only.");
  const force = process.argv.includes("--force");
  const storage = new S3BlobStorage(env);
  const prisma = new PrismaClient();
  await storage.ensureBucket();

  let loaded = 0;
  try {
    const products = await prisma.product.findMany({
      where: { sku: { in: Object.keys(OFFICIAL_PHOTOS) }, deletedAt: null },
      select: { id: true, sku: true, imageKey: true },
    });
    for (const product of products) {
      if (product.imageKey && !force) continue;
      try {
        const { body, mime } = await download(OFFICIAL_PHOTOS[product.sku]!);
        const key = productImageKey(product.sku, randomUUID());
        await storage.put(key, body, mime);
        await prisma.product.update({ where: { id: product.id }, data: { imageKey: key } });
        if (product.imageKey) await storage.delete(product.imageKey);
        loaded += 1;
        process.stdout.write(`  ${product.sku.padEnd(8)} ${mime} ${Math.round(body.length / 1024)} KB
`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  ${product.sku.padEnd(8)} skipped: ${reason}
`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  // Product responses are cached for 10 minutes; restart the API or wait for new URLs to show.
  process.stdout.write(`Loaded ${loaded} product photo(s).
`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}
`);
  process.exit(1);
});
