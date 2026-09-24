import type { UploadItem } from "@/components/ui";
import type { Attachment } from "@/domain";
import { http } from "./http";

// Real file uploads: each file goes to POST /uploads (multipart) and comes back as an Attachment whose
// id is stored on the registration, complaint or job result. Files are served from Attachment.url.

export function uploadFile(file: File, onProgress?: (percent: number) => void): Promise<Attachment> {
  const form = new FormData();
  form.append("file", file, file.name);
  // Sent separately too: some FormData serialisers (jsdom) drop the file name.
  form.append("name", file.name);
  return http
    .post<Attachment>("/uploads", form, {
      // Overrides the instance's JSON default so axios sends real multipart with a boundary.
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    })
    .then((r) => r.data);
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
