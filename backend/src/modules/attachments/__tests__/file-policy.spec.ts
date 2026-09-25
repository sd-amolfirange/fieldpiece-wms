import { ALLOWED_MIME, matchesSignature, maxBytesFor, storageKeyFor } from "../file-policy";

const bytes = (...values: number[]) => Buffer.from(values);
const text = (s: string) => Buffer.from(s, "latin1");

describe("file policy", () => {
  it("allows video only on claims and CSV only on imports", () => {
    expect(ALLOWED_MIME.claim).toContain("video/mp4");
    expect(ALLOWED_MIME.registration).not.toContain("video/mp4");
    expect(ALLOWED_MIME.import).toEqual(["text/csv"]);
  });

  it("allows 50 MB for video and the configured max otherwise", () => {
    expect(maxBytesFor("video/mp4", 10)).toBe(50 * 1024 * 1024);
    expect(maxBytesFor("image/png", 10)).toBe(10);
  });

  it.each([
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)],
    ["image/webp", text("RIFF\0\0\0\0WEBPVP8 ")],
    ["image/heic", text("\0\0\0\x18ftypheic")],
    ["video/mp4", text("\0\0\0\x18ftypisom")],
    ["application/pdf", text("%PDF-1.7")],
    ["text/csv", text("serialNumber,sku\nSC680-1,SC680\n")],
  ])("accepts a real %s", (mime, head) => {
    expect(matchesSignature(mime, head)).toBe(true);
  });

  it("rejects content that doesn't match the declared type", () => {
    expect(matchesSignature("image/png", text("%PDF-1.7"))).toBe(false);
    expect(matchesSignature("application/pdf", bytes(0x4d, 0x5a))).toBe(false); // an .exe
    expect(matchesSignature("text/csv", bytes(0x50, 0x4b, 0x00, 0x04))).toBe(false); // a zip
    expect(matchesSignature("image/gif", text("GIF89a"))).toBe(false); // not on the allow-list
  });

  it("builds random, dated storage keys", () => {
    expect(storageKeyFor("claim", "abc", new Date("2026-09-23T10:00:00Z"))).toBe("claims/2026/09/abc");
  });
});
