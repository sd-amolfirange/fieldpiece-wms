// Magic-byte checks. Never trust the client's Content-Type alone: a file must look like what it claims to be.
// Pure functions.

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

const ISO_BMFF_BRANDS: Record<string, readonly string[]> = {
  "image/heic": ["heic", "heix", "hevc", "hevx", "mif1", "msf1"],
  "image/heif": ["heic", "heix", "hevc", "hevx", "mif1", "msf1"],
  "image/avif": ["avif", "avis", "mif1"],
};

/**
 * True when the first bytes plausibly match `mime`, false when they clearly don't, and null for types without a
 * reliable signature (the caller decides whether to allow those).
 */
export function matchesSignature(mime: string, head: Buffer): boolean | null {
  switch (mime) {
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/gif":
      return ascii(head, 0, 6) === "GIF87a" || ascii(head, 0, 6) === "GIF89a";
    case "image/webp":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    case "image/heic":
    case "image/heif":
    case "image/avif":
      return ascii(head, 4, 8) === "ftyp" && ISO_BMFF_BRANDS[mime]!.includes(ascii(head, 8, 12));
    case "video/mp4":
    case "video/quicktime":
      return ascii(head, 4, 8) === "ftyp";
    case "video/webm":
      return head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3;
    case "application/pdf":
      return ascii(head, 0, 5) === "%PDF-";
    default:
      return null;
  }
}
