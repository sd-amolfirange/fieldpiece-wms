import { createHarness, type Harness, type Session, type Who } from "../setup/harness";

// Role and data-scope matrix (api-contract §1 "Scoping"). One allowed and one denied case per rule.

describe("roles and data scope", () => {
  let h: Harness;
  const s = {} as Record<Who, Session>;
  beforeAll(async () => {
    h = await createHarness();
    for (const who of ["admin", "dealer", "breeze", "distributor", "customer"] as const) s[who] = await h.login(who);
  });
  afterAll(() => h.close());

  const get = (who: Who, url: string) => h.request({ method: "GET", url, as: s[who] });

  it("requires a signed-in user everywhere except the auth routes", async () => {
    for (const url of ["/units", "/registrations", "/complaints", "/claims", "/models", "/dashboard/summary", "/notifications", "/files/ATT-1"]) {
      const res = await h.request({ method: "GET", url });
      expect([url, res.status]).toEqual([url, 401]);
    }
  });

  it("shows each role only its units", async () => {
    const serials = async (who: Who) =>
      ((await get(who, "/units?pageSize=100")).body.items as { serial: string; dealerId?: string; customerId?: string }[]);
    expect(await serials("admin")).toHaveLength(15);
    const coolair = await serials("dealer");
    expect(coolair.length).toBeGreaterThan(0);
    expect(coolair.every((u) => u.dealerId === "d-coolair")).toBe(true);
    const northstar = await serials("distributor");
    expect(new Set(northstar.map((u) => u.dealerId))).toEqual(new Set(["d-coolair", "d-breeze"]));
    const mine = await serials("customer");
    expect(mine.map((u) => u.serial).sort()).toEqual(["AER-SPL15-210311", "AER-SPL18-230502"]);
  });

  it("answers 404, not 403, for a record outside the caller's scope", async () => {
    // KEL-CAS30-230115 belongs to Arctic Home Solutions (no distributor).
    for (const who of ["dealer", "distributor", "customer"] as const) {
      const res = await get(who, "/units/KEL-CAS30-230115");
      expect([who, res.status, res.body.code]).toEqual([who, 404, "not_found"]);
    }
    expect((await get("breeze", "/units/AER-SPL15-210311")).status).toBe(404);
    expect((await get("admin", "/units/KEL-CAS30-230115")).status).toBe(200);
  });

  it("never shows claims to customers and lets partners read their own only", async () => {
    expect((await get("customer", "/claims")).status).toBe(403);
    expect((await get("customer", "/claims/counts")).status).toBe(403);
    const dealerClaims = (await get("dealer", "/claims?pageSize=100")).body.items as { dealerId: string }[];
    expect(dealerClaims.every((c) => c.dealerId === "d-coolair")).toBe(true);
    const all = (await get("admin", "/claims?pageSize=100")).body.items as { id: string; dealerId: string }[];
    const foreign = all.find((c) => c.dealerId === "d-arctic")!;
    expect((await get("dealer", `/claims/${foreign.id}`)).status).toBe(404);
  });

  it("keeps admin-only actions admin-only", async () => {
    const denied: [Who, "GET" | "POST", string][] = [
      ["dealer", "GET", "/integrations"],
      ["distributor", "GET", "/admin/org"],
      ["dealer", "POST", "/registrations/bulk-approve"],
      ["dealer", "POST", "/units/AER-SPL15-210311/void"],
      ["distributor", "POST", "/complaints/CMP-1001/send-to-service"],
      ["dealer", "POST", "/claims/CLM-1002/transitions"],
      ["customer", "POST", "/simulate/erp-invoice"],
      ["customer", "GET", "/dealers"],
      ["customer", "GET", "/bulk-imports"],
    ];
    for (const [who, method, url] of denied) {
      const res = await h.request({ method, url, as: s[who], body: {} });
      expect([who, url, res.status]).toEqual([who, url, 403]);
    }
  });

  it("limits dealer lists to what the caller may see", async () => {
    expect(((await get("admin", "/dealers")).body as unknown[]).length).toBe(3);
    expect(((await get("distributor", "/dealers")).body as { id: string }[]).map((d) => d.id)).toEqual(["d-coolair", "d-breeze"]);
    expect(((await get("dealer", "/dealers")).body as { id: string }[]).map((d) => d.id)).toEqual(["d-coolair"]);
  });

  it("scopes files: the uploader and admins, or anyone who can see a record that uses it", async () => {
    const up = await h.upload(s.dealer, "/uploads", { name: "a.jpg", mime: "image/jpeg", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
    expect(up.status).toBe(201);
    const url = (up.body.url as string).replace(/^\/api/, "");
    expect((await get("dealer", url)).status).toBe(200);
    expect((await get("admin", url)).status).toBe(200);
    expect((await get("breeze", url)).status).toBe(404);
    expect((await get("customer", url)).status).toBe(404);
  });

  it("rejects linking someone else's upload to a new record", async () => {
    const up = await h.upload(s.dealer, "/uploads", { name: "b.jpg", mime: "image/jpeg", content: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) });
    const res = await h.request({
      method: "POST",
      url: "/complaints",
      as: s.customer,
      body: { unitSerial: "AER-SPL15-210311", description: "Not cooling at all", attachmentIds: [up.body.id] },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("invalid_attachment");
  });
});
