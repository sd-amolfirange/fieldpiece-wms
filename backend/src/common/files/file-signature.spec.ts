import { matchesSignature } from "./file-signature";

const bytes = (...values: number[]) => Buffer.from(values);

describe("matchesSignature", () => {
  it("recognises common photo and document types", () => {
    expect(matchesSignature("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(true);
    expect(matchesSignature("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(true);
    expect(matchesSignature("application/pdf", Buffer.from("%PDF-1.7"))).toBe(true);
    expect(matchesSignature("image/gif", Buffer.from("GIF89a..."))).toBe(true);
  });

  it("rejects content that doesn't match the declared type", () => {
    expect(matchesSignature("image/jpeg", Buffer.from("<html>"))).toBe(false);
    expect(matchesSignature("application/pdf", bytes(0xff, 0xd8, 0xff))).toBe(false);
  });

  it("says 'unknown' for types without a signature", () => {
    expect(matchesSignature("image/bmp", Buffer.from("BM"))).toBeNull();
  });
});
