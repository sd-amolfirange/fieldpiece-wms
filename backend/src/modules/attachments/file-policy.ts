// Upload allow-list and magic-byte sniffing (build guide Section 8.5). Pure functions.

export const OWNER_TYPES = ["registration", "claim", "rma", "import"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];

const IMAGES_AND_PDF = ["image/jpeg", "image/png", "image/heic", "image/webp", "application/pdf"] as const;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export const ALLOWED_MIME: Record<OwnerType, readonly string[]> = {
  registration: IMAGES_AND_PDF,
  claim: [...IMAGES_AND_PDF, "video/mp4"],
  rma: IMAGES_AND_PDF,
  import: ["text/csv"],
};

export function maxBytesFor(mime: string, defaultMax: number): number {
  return mime === "video/mp4" ? VIDEO_MAX_BYTES : defaultMax;
}

export const IMAGE_MIME: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
]);

export { matchesSignature } from "../../common/files/file-signature";

/** Random, non-guessable storage key; never the user's file name (Section 8.5). */
export function storageKeyFor(ownerType: OwnerType, id: string, now: Date): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${ownerType}s/${yyyy}/${mm}/${id}`;
}
