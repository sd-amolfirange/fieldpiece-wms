import { createHarness, type Harness, JPEG, type Session, type Who } from "../setup/harness";

// Role and data-scope matrix. One allowed and one denied case per rule.

describe("roles and data scope", () => {
  let h: Harness;
  const s = {} as Record<Who, Session>;
  beforeAll(async () => {
    h = await createHarness();
    for (const who of ["admin", "dealer", "bayou", "distributor", "customer"] as const)
      s[who] = await h.login(who);
  });
  afterAll(() => h.close());

  const get = (who: Who, url: string) => h.request({ method: "GET", url, as: s[who] });

  it("requires a signed-in user everywhere except the auth, public-form and partner routes", async () => {
    for (const url of [
      "/units",
      "/registrations",
      "/claims",
      "/models",
      "/dashboard/summary",
      "/notifications",
      "/files/ATT-1",
      "/intake",
    ]) {
      const res = await h.request({ method: "GET", url });
      expect([url, res.status]).toEqual([url, 401]);
    }
    expect((await h.request({ method: "GET", url: "/public/models" })).status).toBe(200);
  });

  it("shows each role only its products", async () => {
    const products = async (who: Who) =>
      (await get(who, "/units?pageSize=100")).body.items as {
        serial: string;
        dealerId?: string;
        customerId?: string;
      }[];
    expect((await get("admin", "/units?pageSize=1")).body.total).toBe(267);
    const lonestar = await products("dealer");
    expect(lonestar.length).toBeGreaterThan(0);
    expect(lonestar.every((u) => u.dealerId === "d-lonestar")).toBe(true);
    const gulfstates = await products("distributor");
    expect(new Set(gulfstates.map((u) => u.dealerId))).toEqual(new Set(["d-lonestar", "d-bayou"]));
    expect((await products("customer")).map((u) => u.serial).sort()).toEqual([
      "DR58-252891567",
      "DR82-252207119",
      "JL3KR4-252479315",
      "MG44-253177420",
      "SC440-263473208",
      "SC680-251406233",
      "SM480V-252586104",
      "VP87-243208841",
    ]);
  });

  it("answers 404, not 403, for a record outside the caller's scope", async () => {
    // SC680-252409963 belongs to Desert Peak HVAC Supply (no distributor).
    for (const who of ["dealer", "distributor", "customer"] as const) {
      const res = await get(who, "/units/SC680-252409963");
      expect([who, res.status, res.body.code]).toEqual([who, 404, "not_found"]);
    }
    expect((await get("bayou", "/units/SC680-251406233")).status).toBe(404);
    expect((await get("admin", "/units/SC680-252409963")).status).toBe(200);
  });

  it("scopes warranty claims: customers see their own, dealers their products', admins all", async () => {
    const ids = async (who: Who) =>
      (await get(who, "/claims?pageSize=100")).body.items as { dealerId: string; customerId: string }[];
    expect(await ids("admin")).toHaveLength(53);
    expect((await ids("dealer")).every((c) => c.dealerId === "d-lonestar")).toBe(true);
    expect((await ids("customer")).every((c) => c.customerId === "c-mreed")).toBe(true);
    const all = (await get("admin", "/claims?pageSize=100")).body.items as { id: string; dealerId: string }[];
    const foreign = all.find((c) => c.dealerId === "d-desertpeak")!;
    expect((await get("dealer", `/claims/${foreign.id}`)).status).toBe(404);
    expect((await get("customer", `/claims/${foreign.id}`)).status).toBe(404);
  });

  it("scopes extended warranties and the finance insights", async () => {
    // SC680-251406233 belongs to Lone Star (Marcus Reed).
    expect((await get("bayou", "/units/SC680-251406233/extension")).status).toBe(404);
    const foreign = await h.request({
      method: "POST",
      url: "/units/SC680-251406233/extensions",
      as: s.bayou,
      body: { months: 12 },
    });
    expect(foreign.status).toBe(404);
    expect((await get("customer", "/units/SC680-252409963/extension")).status).toBe(404);
    expect((await get("customer", "/units/SC680-251406233/extension")).body.eligible).toBe(true);
    expect((await get("customer", "/dashboard/finance")).status).toBe(403);
    expect((await h.request({ method: "GET", url: "/dashboard/finance" })).status).toBe(401);
    const bayou = (await get("bayou", "/dashboard/finance")).body;
    expect(bayou).toMatchObject({ warrantyCost: 1584.4, extensionsSold: 2 });
  });

  it("keeps warranty desk actions admin-only", async () => {
    const denied: [Who, "GET" | "POST" | "PATCH", string][] = [
      ["dealer", "GET", "/integrations"],
      ["distributor", "GET", "/admin/org"],
      ["dealer", "GET", "/admin/partner-clients"],
      ["dealer", "POST", "/registrations/bulk-approve"],
      ["dealer", "POST", "/units/SC680-251406233/void"],
      ["distributor", "POST", "/claims/CLM-1006/transitions"],
      ["customer", "POST", "/claims/CLM-1006/transitions"],
      ["customer", "POST", "/simulate/erp-invoice"],
      ["customer", "GET", "/dealers"],
      ["customer", "GET", "/bulk-imports"],
      ["customer", "GET", "/intake"],
      ["dealer", "PATCH", "/models/m-sc680"],
      ["distributor", "PATCH", "/models/m-sc680"],
    ];
    for (const [who, method, url] of denied) {
      const res = await h.request({ method, url, as: s[who], body: {} });
      expect([who, url, res.status]).toEqual([who, url, 403]);
    }
  });

  it("limits dealer lists to what the caller may see", async () => {
    expect(((await get("admin", "/dealers")).body as unknown[]).length).toBe(3);
    expect(((await get("distributor", "/dealers")).body as { id: string }[]).map((d) => d.id)).toEqual([
      "d-lonestar",
      "d-bayou",
    ]);
    expect(((await get("dealer", "/dealers")).body as { id: string }[]).map((d) => d.id)).toEqual([
      "d-lonestar",
    ]);
  });

  it("scopes files: the uploader and admins, or anyone who can see a record that uses it", async () => {
    const up = await h.upload(s.dealer, "/uploads", { name: "a.jpg", mime: "image/jpeg", content: JPEG });
    expect(up.status).toBe(201);
    const url = (up.body.url as string).replace(/^\/api/, "");
    expect((await get("dealer", url)).status).toBe(200);
    expect((await get("admin", url)).status).toBe(200);
    expect((await get("bayou", url)).status).toBe(404);
    expect((await get("customer", url)).status).toBe(404);
  });

  it("rejects linking someone else's upload to a new record", async () => {
    const up = await h.upload(s.dealer, "/uploads", { name: "b.jpg", mime: "image/jpeg", content: JPEG });
    const res = await h.request({
      method: "POST",
      url: "/claims",
      as: s.customer,
      body: {
        unitSerial: "SC680-251406233",
        issueType: "DISPLAY",
        description: "Display flickers all the time.",
        attachmentIds: [up.body.id],
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("invalid_attachment");
  });
});
