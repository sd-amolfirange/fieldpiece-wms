import { http } from "./http";

/** Saves a blob as a file (works on desktop browsers and on phones). */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads an authenticated API file (the bearer token goes with the request). */
export async function downloadApiFile(path: string, fileName: string) {
  const { data } = await http.get<Blob>(path, { responseType: "blob" });
  saveBlob(data, fileName);
}
