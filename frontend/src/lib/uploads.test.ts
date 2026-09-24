import type { UploadItem } from "@/components/ui";
import { signInAs } from "@/test/sign-in";
import { http } from "./http";
import { useSession } from "./session";
import { uploadAll, uploadFile } from "./uploads";

describe("uploads", () => {
  afterEach(() => useSession.getState().signOut());

  it("uploads a file and serves it back to the uploader", async () => {
    await signInAs("customer.rk@demo.wms");
    const attachment = await uploadFile(new File(["invoice-bytes"], "invoice.jpg", { type: "image/jpeg" }));
    expect(attachment).toMatchObject({ name: "invoice.jpg", mime: "image/jpeg", size: 13 });
    expect(attachment.url).toBe(`/api/files/${attachment.id}`);

    const file = await http.get<Blob>(`/files/${attachment.id}`, { responseType: "blob" });
    expect(file.status).toBe(200);
  });

  it("hides the file from another dealer", async () => {
    await signInAs("customer.rk@demo.wms");
    const attachment = await uploadFile(new File(["x"], "photo.png", { type: "image/png" }));
    await signInAs("dealer.breeze@demo.wms");
    await expect(http.get(`/files/${attachment.id}`)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects unsupported file types", async () => {
    await signInAs("customer.rk@demo.wms");
    await expect(
      uploadFile(new File(["x"], "tool.exe", { type: "application/x-msdownload" })),
    ).rejects.toMatchObject({
      status: 415,
    });
  });

  it("uploads every item once, reports progress and returns the attachment ids", async () => {
    await signInAs("dealer.coolair@demo.wms");
    const items: UploadItem[] = [
      { file: new File(["a"], "a.jpg", { type: "image/jpeg" }) },
      { file: new File(["b"], "b.pdf", { type: "application/pdf" }) },
    ];
    const updates: UploadItem[][] = [];
    const cache = new Map();
    const ids = await uploadAll(items, (next) => updates.push(next), cache);
    expect(ids).toHaveLength(2);
    expect(updates.at(-1)?.every((i) => i.progress === 100)).toBe(true);

    // A retry doesn't upload the same files again.
    const again = await uploadAll(items, () => {}, cache);
    expect(again).toEqual(ids);
  });
});
