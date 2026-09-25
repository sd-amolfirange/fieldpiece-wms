import { buildWorld, type World } from "../fixtures/factories";
import { createHarness, type Harness } from "../setup/harness";

// Product photos: admin upload straight to storage, magic-byte check on attach, public cacheable read.
// Needs MinIO from docker compose (same as the dev stack).

let h: Harness;
let world: World;
const tokens: Record<string, string> = {};

/** Smallest valid PNG: signature plus IHDR, enough for the magic-byte check. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

async function upload(sku: string, body: Buffer, contentType = "image/png") {
  const start = await h.request({
    method: "POST",
    url: `/products/${sku}/image/upload-url`,
    token: tokens.admin,
    body: { contentType, contentLength: body.length },
  });
  expect(start.status).toBe(201);
  const put = await fetch(String(start.body.uploadUrl), {
    method: "PUT",
    body,
    headers: start.body.headers as Record<string, string>,
  });
  expect(put.ok).toBe(true);
  return String(start.body.key);
}

beforeAll(async () => {
  h = await createHarness();
  world = await buildWorld(h.db);
  for (const [key, u] of Object.entries(world.users)) tokens[key] = await h.tokenFor(u.email);
});
afterAll(() => h.close());

describe("product images", () => {
  it("attaches an uploaded photo and serves it publicly with long-lived caching", async () => {
    const key = await upload("SC680", PNG);
    const attached = await h.request({
      method: "PUT",
      url: "/products/SC680/image",
      token: tokens.admin,
      body: { key },
    });
    expect(attached.status).toBe(200);
    const imageUrl = new URL(String(attached.body.imageUrl));
    expect(imageUrl.pathname).toBe("/api/v1/products/SC680/image");
    const version = imageUrl.searchParams.get("v");
    expect(key.endsWith(version!)).toBe(true);

    // Lists show the same URL (the cache was invalidated).
    const list = await h.request({ method: "GET", url: "/products?q=SC680", token: tokens.tech });
    expect((list.body.items as { imageUrl: string }[])[0]?.imageUrl).toBe(attached.body.imageUrl);

    const image = await h.request({ method: "GET", url: `/products/SC680/image?v=${version}` });
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/png");
    expect(image.headers["cache-control"]).toContain("immutable");
    expect(image.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(image.raw.equals(PNG)).toBe(true);

    const notModified = await h.request({
      method: "GET",
      url: `/products/SC680/image?v=${version}`,
      headers: { "if-none-match": `"${version}"` },
    });
    expect(notModified.status).toBe(304);

    // An old ?v= still resolves, but isn't cached for long.
    const stale = await h.request({ method: "GET", url: "/products/SC680/image?v=old" });
    expect(stale.headers["cache-control"]).toBe("public, max-age=60");
  });

  it("rejects content that isn't the image type it claims, and deletes it", async () => {
    const key = await upload("SC680", Buffer.from("%PDF-1.7 not a png"));
    const res = await h.request({
      method: "PUT",
      url: "/products/SC680/image",
      token: tokens.admin,
      body: { key },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("ATTACHMENT_INVALID");
  });

  it("refuses a key issued for another product", async () => {
    const res = await h.request({
      method: "PUT",
      url: "/products/SC680/image",
      token: tokens.admin,
      body: { key: "products/OTHER/3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b" },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_FAILED");
  });

  it("is admin-only to change, and 404s once removed", async () => {
    const denied = await h.request({
      method: "POST",
      url: "/products/SC680/image/upload-url",
      token: tokens.agent,
      body: { contentType: "image/png", contentLength: 10 },
    });
    expect(denied.status).toBe(403);

    const removed = await h.request({ method: "DELETE", url: "/products/SC680/image", token: tokens.admin });
    expect(removed.status).toBe(200);
    expect(removed.body.imageUrl).toBeNull();
    expect((await h.request({ method: "GET", url: "/products/SC680/image" })).status).toBe(404);
  });
});
