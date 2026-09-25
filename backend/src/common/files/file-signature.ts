// Magic-byte sniffing shared by attachments and product images (build guide Section 8.5). Pure functions.

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString("latin1");

/**
 * Checks the file's first bytes against its declared type. Never trust the client's Content-Type alone.
 * Returns true when the content plausibly is what it claims to be.
 */
export function matchesSignature(mime: string, head: Buffer): boolean {
  switch (mime) {
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
    case "image/heic":
      return (
        ascii(head, 4, 8) === "ftyp" && ["heic", "heix", "mif1", "msf1", "hevc"].includes(ascii(head, 8, 12))
      );
    case "video/mp4":
      return ascii(head, 4, 8) === "ftyp";
    case "application/pdf":
      return ascii(head, 0, 5) === "%PDF-";
    case "text/csv":
      // No magic number for CSV: require text (no NUL bytes) in the sample.
      return head.length > 0 && !head.includes(0x00);
    default:
      return false;
  }
}
