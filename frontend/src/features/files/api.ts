import type { Attachment } from "@wms/domain";
import { http } from "@/lib/http";

// Real file uploads and authenticated downloads. Each upload comes back as an Attachment whose id is stored
// on the registration, complaint or job result; files are served from Attachment.url.
export const filesApi = {
  upload: (file: File, onProgress?: (percent: number) => void) => {
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
  },
  /** An API file as a blob (the bearer token goes with the request), e.g. a certificate PDF. */
  download: (path: string) => http.get<Blob>(path, { responseType: "blob" }).then((r) => r.data),
};
