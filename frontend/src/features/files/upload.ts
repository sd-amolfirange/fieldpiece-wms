import type { UploadItem } from "@/components/ui";
import type { Attachment } from "@wms/domain";
import { filesApi } from "./api";

// Uploads a form's files with per-file progress and returns their attachment ids.

export const uploadFile = filesApi.upload;

/** HEIC/HEIF (iPhone "High efficiency") photos: most browsers can't show them, so they're refused up front. */
export const isHeic = (file: File) => /^image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** Splits HEIC photos out of a dropzone selection; `heic` holds their file names for the message. */
export function dropHeic(items: UploadItem[]): { kept: UploadItem[]; heic: string[] } {
  return {
    kept: items.filter((item) => !isHeic(item.file)),
    heic: items.filter((item) => isHeic(item.file)).map((item) => item.file.name),
  };
}

/**
 * Uploads every item that hasn't been uploaded yet, reporting progress per file through `onChange`.
 * Resolves with all attachment ids, or rejects on the first failure (the item gets its error message).
 */
export async function uploadAll(
  items: UploadItem[],
  onChange: (items: UploadItem[]) => void,
  uploaded: Map<File, Attachment> = new Map(),
): Promise<string[]> {
  let current = items;
  const update = (index: number, patch: Partial<UploadItem>) => {
    current = current.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(current);
  };

  const ids: string[] = [];
  for (const [index, item] of items.entries()) {
    const done = uploaded.get(item.file);
    if (done) {
      ids.push(done.id);
      continue;
    }
    update(index, { progress: 0, error: undefined });
    try {
      const attachment = await uploadFile(item.file, (progress) => update(index, { progress }));
      uploaded.set(item.file, attachment);
      update(index, { progress: 100 });
      ids.push(attachment.id);
    } catch (error) {
      update(index, { progress: undefined, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  return ids;
}
