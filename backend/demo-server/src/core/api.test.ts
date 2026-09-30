import { addDaysIso, addMonthsIso, type Paginated, type UnitView } from "@wms/domain";
import { createSessionStore, dispatch, type DemoDb, type DemoRequest, type DemoResponse } from "./api";
import { createSeed, DEMO_PARTNER_KEYS, DEMO_PASSWORD } from "./seed";
import type { DemoFile } from "./services";

// The mock API end to end through dispatch(), ported from the backend's e2e tests (backend/test/e2e), so the mock and
// the real backend answer the same requests the same way.

const TODAY = "2026-09-28";
const SECRET = "test-inbound-secret-0123456789";
const JPEG: DemoFile = {
  name: "receipt.jpg",
  mime: "image/jpeg",
  size: 4,
  data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
};

type Who = "admin" | "dealer" | "bayou" | "desertpeak" | "distributor" | "customer";
const EMAILS: Record<Who, string> = {
  admin: "admin@wms.local",
  dealer: "dealer.lonestar@wms.local",
  bayou: "dealer.bayou@wms.local",
  desertpeak: "dealer.desertpeak@wms.local",
  distributor: "dist.gulfstates@wms.local",
  customer: "customer.mreed@wms.local",
};

// Response bodies are loosely typed on purpose: each test reads the fields it checks.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

function setup() {
  const db: DemoDb = { state: createSeed(TODAY), today: () => TODAY, inboundEmailSecret: SECRET };
  const sessions = createSessionStore();
  const tokens = {} as Record<Who, string>;
  const raw = (req: Partial<DemoRequest> & { path: string }): DemoResponse =>
    dispatch(db, sessions, { method: "GET", query: {}, ...req });
  const login = (who: Who) => {
    const res = raw({
      method: "POST",
      path: "/auth/login",
      body: { email: EMAILS[who], password: DEMO_PASSWORD },
    });
    expect(res.status).toBe(200);
    return (res.body as { accessToken: string }).accessToken;
  };
  for (const who of Object.keys(EMAILS) as Who[]) tokens[who] = login(who);
  const call = (who: Who | null, method: string, path: string, extra: Partial<DemoRequest> = {}) => {
    const [pathname, search = ""] = path.split("?");
    const res = raw({
      method,
      path: pathname!,
      query: Object.fromEntries(new URLSearchParams(search)),
      accessToken: who ? tokens[who] : undefined,
      ...extra,
    });
    return { status: res.status, body: res.body as Body, download: res.download };
  };
  const get = (who: Who | null, path: string) => call(who, "GET", path);
  const post = (who: Who | null, path: string, body?: unknown, extra: Partial<DemoRequest> = {}) =>
    call(who, "POST", path, { body, ...extra });
  const move = (id: string, body: Record<string, unknown>) =>
    post("admin", `/claims/${id}/transitions`, body);
  const upload = (who: Who, file: DemoFile = JPEG) => post(who, "/uploads", {}, { file });
  const units = (who: Who, query = "") => get(who, `/units?pageSize=100${query}`).body as Paginated<UnitView>;
  /** Every page of the product list. */
  const allUnits = (who: Who, query = "") => {
    const items: UnitView[] = [];
    for (let page = 1; ; page += 1) {
      const res = units(who, `${query}&page=${page}`);
      items.push(...res.items);
      if (items.length >= res.total || !res.items.length) return { total: res.total, items };
    }
  };
  return { db, sessions, tokens, raw, login, call, get, post, move, upload, units, allUnits };
}

describe("seed", () => {
  const state = createSeed(TODAY);

  it("has the backend's accounts, products, claims and partner keys", () => {
    expect(state.users.map((u) => u.email)).toEqual(expect.arrayContaining(Object.values(EMAILS)));
    expect(state.units).toHaveLength(267);
    expect(state.claims).toHaveLength(53);
    expect(state.claims.slice(0, 7).map((c) => c.id)).toEqual([
      "CLM-1001",
      "CLM-1002",
      "CLM-1003",
      "CLM-1004",
      "CLM-1005",
      "CLM-1006",
      "CLM-1007",
    ]);
    expect(state.partnerClients.map((p) => [p.id, p.apiKey])).toEqual(Object.entries(DEMO_PARTNER_KEYS));
    expect(state.units.find((u) => u.serial === "SM482V-261804517")).toMatchObject({
      batchNumber: "2618-L02",
      dealerId: "d-lonestar",
    });
    expect(state.units.find((u) => u.serial === "SM482V-261804517")?.warrantyEnd).toBeUndefined();
  });

  it("generates the same demo volume on every load, clear of the labels the tests and the bulk sample use", () => {
    expect(createSeed(TODAY)).toEqual(createSeed(TODAY));
    const labels = [...state.units, ...state.registrations].map((x) => `${x.serial} ${x.batchNumber ?? ""}`);
    expect(labels.filter((l) => /2635|2638|2639/.test(l))).toEqual([]);
    const numbers = state.units.map((u) => u.serial.slice(u.serial.lastIndexOf("-") + 1));
    expect(new Set(numbers).size).toBe(numbers.length);
    // Every dealer has registrations this month (DL01), whatever the day of the month.
    for (const today of [TODAY, "2026-10-01"]) {
      const seed = createSeed(today);
      for (const dealer of seed.dealers) {
        const count = seed.registrations.filter(
          (r) => r.dealerId === dealer.id && r.submittedAt.slice(0, 7) === today.slice(0, 7),
        ).length;
        expect([today, dealer.id, count >= 6]).toEqual([today, dealer.id, true]);
      }
    }
  });

  it("places the named products relative to today and continues the id sequences", () => {
    const s = setup();
    expect(s.get("admin", "/units/SC680-251406233").body).toMatchObject({
      status: "ACTIVE",
      categoryName: "Clamp meters",
    });
    expect(s.get("admin", "/units/VP87-243208841").body.status).toBe("EXPIRED");
    expect(s.get("admin", "/units/SM382V-252707701").body).toMatchObject({
      replacesSerial: "SM382V-252005531",
    });
    const reg = s.post("dealer", "/registrations", {
      serial: "263899001",
      batchNumber: "2638-L01",
      modelCode: "SC680",
      purchaseDate: TODAY,
      customerName: "Pat Moreno",
    });
    expect(reg.body.id).toBe("REG-1271");
  });
});

describe("auth", () => {
  it("signs in with a trimmed, case-insensitive email and returns the session user", () => {
    const s = setup();
    const res = s.post(null, "/auth/login", {
      email: " Dealer.LoneStar@wms.local ",
      password: DEMO_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(JSON.stringify(res.body.user))).toEqual({
      id: "u-lonestar",
      name: "Lone Star Refrigeration Supply",
      email: "dealer.lonestar@wms.local",
      role: "dealer",
      dealerId: "d-lonestar",
      orgName: "Lone Star Refrigeration Supply",
      currency: "USD",
    });
  });

  it("answers invalid_credentials for a wrong password or an unknown email", () => {
    const s = setup();
    for (const body of [{ email: "admin@wms.local", password: "wrong" }, { email: "nobody@wms.local" }, {}]) {
      const res = s.post(null, "/auth/login", body);
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "invalid_credentials", requestId: expect.any(String) });
    }
  });

  it("refreshes with the session cookie and ends both tokens on logout", () => {
    const s = setup();
    const login = s.raw({
      method: "POST",
      path: "/auth/login",
      body: { email: EMAILS.customer, password: DEMO_PASSWORD },
    });
    const refresh = login.setRefreshToken!;
    expect(s.raw({ method: "POST", path: "/auth/refresh", refreshToken: refresh }).status).toBe(200);
    expect(s.raw({ method: "POST", path: "/auth/refresh" }).body).toMatchObject({ code: "unauthenticated" });
    const access = (login.body as { accessToken: string }).accessToken;
    expect(
      s.raw({ method: "POST", path: "/auth/logout", accessToken: access, refreshToken: refresh }).status,
    ).toBe(204);
    expect(s.raw({ path: "/units", accessToken: access }).status).toBe(401);
    expect(s.raw({ method: "POST", path: "/auth/refresh", refreshToken: refresh }).status).toBe(401);
  });

  it("offers the demo accounts for the sign-in picker", () => {
    const s = setup();
    const res = s.get(null, "/auth/demo-accounts");
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toEqual({
      email: "admin@wms.local",
      label: "Admin: Fieldpiece warranty desk",
      password: DEMO_PASSWORD,
    });
  });

  it("accepts the session cookie only on file routes, never on JSON endpoints", () => {
    const s = setup();
    const refresh = s.raw({
      method: "POST",
      path: "/auth/login",
      body: { email: EMAILS.customer, password: DEMO_PASSWORD },
    }).setRefreshToken!;
    expect(s.raw({ path: "/units", refreshToken: refresh }).status).toBe(401);
    const pdf = s.raw({ path: "/units/SC680-251406233/certificate.pdf", refreshToken: refresh });
    expect(pdf.status).toBe(200);
    expect(pdf.download).toMatchObject({ mime: "application/pdf", name: "warranty-SC680-251406233.pdf" });
    expect(String(pdf.download?.data).slice(0, 5)).toBe("%PDF-");
    expect(s.raw({ path: "/units/SM482V-261804517/certificate.pdf", refreshToken: refresh }).status).toBe(
      404,
    );
    expect(s.get("admin", "/units/SM482V-261804517/certificate.pdf").body.code).toBe("not_registered");
  });
});

describe("roles and data scope", () => {
  it("requires a signed-in user everywhere except the auth, public-form and partner routes", () => {
    const s = setup();
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
      expect([url, s.get(null, url).status]).toEqual([url, 401]);
    }
    expect(s.get(null, "/public/models").status).toBe(200);
    expect(s.get("admin", "/nowhere").status).toBe(404);
  });

  it("shows each role only its products", () => {
    const s = setup();
    expect(s.units("admin").total).toBe(267);
    const lonestar = s.units("dealer").items;
    expect(lonestar.length).toBeGreaterThan(0);
    expect(lonestar.every((u) => u.dealerId === "d-lonestar")).toBe(true);
    expect(new Set(s.units("distributor").items.map((u) => u.dealerId))).toEqual(
      new Set(["d-lonestar", "d-bayou"]),
    );
    expect(
      s
        .units("customer")
        .items.map((u) => u.serial)
        .sort(),
    ).toEqual([
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

  it("answers 404, not 403, for a record outside the caller's scope", () => {
    const s = setup();
    for (const who of ["dealer", "distributor", "customer"] as const) {
      const res = s.get(who, "/units/SC680-252409963");
      expect([who, res.status, res.body.code]).toEqual([who, 404, "not_found"]);
    }
    expect(s.get("bayou", "/units/SC680-251406233").status).toBe(404);
    expect(s.get("admin", "/units/SC680-252409963").status).toBe(200);
  });

  it("scopes warranty claims: customers see their own, dealers their products', admins all", () => {
    const s = setup();
    const claims = (who: Who) =>
      s.get(who, "/claims?pageSize=100").body.items as { id: string; dealerId: string; customerId: string }[];
    expect(claims("admin")).toHaveLength(53);
    expect(claims("dealer").every((c) => c.dealerId === "d-lonestar")).toBe(true);
    expect(claims("customer").every((c) => c.customerId === "c-mreed")).toBe(true);
    const foreign = claims("admin").find((c) => c.dealerId === "d-desertpeak")!;
    expect(s.get("dealer", `/claims/${foreign.id}`).status).toBe(404);
    expect(s.get("customer", `/claims/${foreign.id}`).status).toBe(404);
    expect(s.get("dealer", "/claims/counts").body).toMatchObject({ CLOSED: 10, IN_REVIEW: 2, REJECTED: 4 });
  });

  it("keeps warranty desk actions admin-only", () => {
    const s = setup();
    const denied: [Who, string, string][] = [
      ["dealer", "GET", "/integrations"],
      ["distributor", "GET", "/admin/org"],
      ["dealer", "GET", "/admin/partner-clients"],
      ["dealer", "POST", "/registrations/bulk-approve"],
      ["dealer", "POST", "/units/SC680-251406233/void"],
      ["distributor", "POST", "/claims/CLM-1006/transitions"],
      ["customer", "POST", "/claims/CLM-1006/transitions"],
      ["customer", "POST", "/simulate/erp-invoice"],
      ["customer", "POST", "/simulate/reset"],
      ["customer", "GET", "/dealers"],
      ["customer", "GET", "/bulk-imports"],
      ["customer", "GET", "/intake"],
    ];
    for (const [who, method, url] of denied) {
      expect([who, url, s.call(who, method, url, { body: {} }).status]).toEqual([who, url, 403]);
    }
  });

  it("limits dealer lists to what the caller may see", () => {
    const s = setup();
    expect(s.get("admin", "/dealers").body).toHaveLength(3);
    expect(s.get("distributor", "/dealers").body.map((d: { id: string }) => d.id)).toEqual([
      "d-lonestar",
      "d-bayou",
    ]);
    expect(s.get("dealer", "/dealers").body.map((d: { id: string }) => d.id)).toEqual(["d-lonestar"]);
  });

  it("scopes files: the uploader and admins, or anyone who can see a record that uses it", () => {
    const s = setup();
    const up = s.upload("dealer");
    expect(up.status).toBe(201);
    expect(up.body.url).toBe(`/api/files/${up.body.id}`);
    const url = `/files/${up.body.id}`;
    expect(s.get("dealer", url).download).toMatchObject({ mime: "image/jpeg", disposition: "inline" });
    expect(s.get("admin", url).status).toBe(200);
    expect(s.get("bayou", url).status).toBe(404);
    expect(s.get("customer", url).status).toBe(404);
  });

  it("checks uploads and refuses linking someone else's upload to a new record", () => {
    const s = setup();
    expect(s.post("dealer", "/uploads", {}).status).toBe(422);
    expect(s.upload("dealer", { name: "x.svg", mime: "image/svg+xml", size: 10 }).body.code).toBe(
      "unsupported_type",
    );
    expect(s.upload("dealer", { ...JPEG, size: 16 * 1024 * 1024 }).body.code).toBe("too_large");
    const up = s.upload("dealer");
    const res = s.post("customer", "/claims", {
      unitSerial: "SC680-251406233",
      issueType: "DISPLAY",
      description: "Display flickers all the time.",
      attachmentIds: [up.body.id],
    });
    expect([res.status, res.body.code]).toEqual([422, "invalid_attachment"]);
  });
});

describe("registration entry points", () => {
  it("W1: bulk import registers clean rows, sends the duplicate to review, and re-checks fixed rows in place", () => {
    const s = setup();
    const sheet = [
      [
        "Serial number",
        "Batch number",
        "Model",
        "Purchase date",
        "Customer name",
        "Customer phone",
        "State",
        "ZIP",
      ],
      ["263510101", "2635-L01", "SC680", TODAY, "Adam Rhodes", "(713) 555-0102", "TX", "77002"],
      ["MG44-252811902", "2528-L01", "MG44", TODAY, "Bianca Flores", "(713) 555-0103", "TX", "77502"],
      ["263510103", "2635-L01", "SC999", TODAY, "Carl Jenkins", "(713) 555-0104", "TX", "77581"],
      ["263510104", "2635-L02", "VP87", "", "Dana Scott", "(713) 555-0105", "TX", "77373"],
    ];
    const file: DemoFile = { name: "week38.csv", mime: "text/csv", size: 100 };
    expect(s.post("dealer", "/bulk-imports", {}).status).toBe(422);
    expect(s.post("dealer", "/bulk-imports", {}, { file: { ...file, name: "a.txt" } }).body.code).toBe(
      "unsupported_type",
    );
    expect(s.post("dealer", "/bulk-imports", {}, { file, sheet: null }).body.code).toBe("unsupported_type");
    expect(s.post("dealer", "/bulk-imports", {}, { file, sheet: [sheet[0]!] }).body.code).toBe("empty_file");
    expect(s.post("distributor", "/bulk-imports", {}, { file, sheet }).body.fieldErrors).toEqual({
      dealerId: "validation.pickDealer",
    });

    const up = s.post("dealer", "/bulk-imports", { name: "week38.csv" }, { file, sheet });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ fileName: "week38.csv", dealerName: "Lone Star Refrigeration Supply" });
    expect(up.body.counts).toEqual({ total: 4, registered: 1, errors: 2, review: 1 });
    const errors = (
      up.body.rows as { rowNumber: number; status: string; errors: Record<string, string> }[]
    ).filter((r) => r.status === "ERROR");
    expect(errors.flatMap((r) => Object.values(r.errors)).sort()).toEqual(["required", "unknown_model"]);

    const fixes = errors.map((r) => ({
      rowNumber: r.rowNumber,
      values: r.errors.purchaseDate ? { purchaseDate: TODAY } : { modelCode: "SC680" },
    }));
    const fixed = s.call("dealer", "PUT", `/bulk-imports/${up.body.id}/rows`, { body: { rows: fixes } });
    expect(fixed.body.counts).toEqual({ total: 4, registered: 3, errors: 0, review: 1 });
    expect(fixed.body.rows.map((r: { status: string }) => r.status)).toEqual([
      "REGISTERED",
      "REVIEW",
      "FIXED",
      "FIXED",
    ]);

    expect(s.get("dealer", "/units?q=263510101").body.items[0]).toMatchObject({
      batchNumber: "2635-L01",
      status: "ACTIVE",
    });
    const inbox = s.get("admin", "/registrations?flag=DUPLICATE&status=PENDING");
    expect(inbox.body.items.some((r: { channel: string }) => r.channel === "BULK")).toBe(true);
    expect(s.get("dealer", "/bulk-imports").body).toHaveLength(1);
    expect(s.get("bayou", `/bulk-imports/${up.body.id}`).status).toBe(404);
    expect(s.get("dealer", "/notifications").body[0]).toMatchObject({ key: "bulk_processed" });
    expect(String(s.get("dealer", "/bulk-imports/template.csv").download?.data)).toMatch(
      /^Serial number,Batch number,Model/,
    );
  });

  it("DL03: a dealer's registration needs a batch number in the model's format and is approved at once", () => {
    const s = setup();
    const bad = s.post("dealer", "/registrations", {
      serial: "SC680-1",
      modelCode: "SC680",
      purchaseDate: TODAY,
      customerName: "X",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.fieldErrors).toEqual({
      serial: "rowErrors.invalid_serial",
      batchNumber: "rowErrors.required",
    });
    expect(
      s.post("dealer", "/registrations", {
        serial: "263899001",
        batchNumber: "L01",
        modelCode: "SC680",
        purchaseDate: TODAY,
        customerName: "X",
      }).body.fieldErrors,
    ).toEqual({ batchNumber: "rowErrors.invalid_batch" });

    const ok = s.post("dealer", "/registrations", {
      serial: "263899001",
      batchNumber: "2638-l01",
      modelCode: "SC680",
      purchaseDate: "2026-01-10",
      customerName: "Alicia Parker",
      customerPhone: "7135550117", // matches the existing customer by phone
    });
    expect(ok.body).toMatchObject({
      status: "APPROVED",
      channel: "DEALER",
      dealerId: "d-lonestar",
      customerId: "c-aparker",
      batchNumber: "2638-L01",
    });
    expect(s.get("dealer", "/units/SC680-263899001").body).toMatchObject({
      warrantyStart: "2026-01-10",
      warrantyEnd: "2027-01-09",
      categoryName: "Clamp meters",
    });
    // Already registered: waits for the warranty desk as a duplicate.
    const again = s.post("dealer", "/registrations", {
      serial: "263899001",
      batchNumber: "2638-L01",
      modelCode: "SC680",
      purchaseDate: TODAY,
      customerName: "Someone Else",
    });
    expect(again.body).toMatchObject({ status: "PENDING", flags: ["DUPLICATE", "EXCEPTION"] });
    expect(s.post("admin", `/registrations/${again.body.id}/approve`).body.code).toBe("duplicate_serial");
    expect(s.get("admin", `/registrations/${again.body.id}`).body.duplicateOf).toMatchObject({
      serial: "SC680-263899001",
    });
    expect(s.get("dealer", `/registrations/${again.body.id}`).body.duplicateOf).toBeUndefined();
    expect(s.post("admin", `/registrations/${again.body.id}/merge`).body.status).toBe("APPROVED");
    expect(s.post("admin", `/registrations/${again.body.id}/merge`).body.code).toBe("not_pending");
  });

  it("W2: a customer's QR registration waits for the warranty desk, then starts the 1-year warranty", () => {
    const s = setup();
    const noProof = s.post("customer", "/registrations", {
      serial: "SM482V-261804517",
      modelCode: "SM482V",
      purchaseDate: TODAY,
    });
    expect(noProof.body.fieldErrors).toEqual({ attachmentIds: "validation.invoiceRequired" });
    const up = s.upload("customer");
    const reg = s.post("customer", "/registrations", {
      serial: "SM482V-261804517",
      modelCode: "SM482V",
      purchaseDate: TODAY,
      attachmentIds: [up.body.id],
    });
    expect(reg.body).toMatchObject({
      status: "PENDING",
      channel: "PORTAL",
      flags: [],
      dealerId: "d-lonestar",
    });
    expect(s.post("admin", `/registrations/${reg.body.id}/approve`).body.status).toBe("APPROVED");
    const unit = s.get("customer", "/units/SM482V-261804517").body;
    expect(unit).toMatchObject({
      status: "ACTIVE",
      batchNumber: "2618-L02",
      warrantyStart: TODAY,
      customerId: "c-mreed",
    });
    expect(unit.daysRemaining).toBeGreaterThan(360);
    expect(s.get("customer", `/files/${up.body.id}`).status).toBe(200);
    expect(s.get("customer", "/notifications").body[0]).toMatchObject({ key: "registration_approved" });
  });

  it("rejects with a reason and tells the submitter", () => {
    const s = setup();
    const up = s.upload("customer");
    const reg = s.post("customer", "/registrations", {
      serial: "263899011",
      modelCode: "SC680",
      purchaseDate: TODAY,
      attachmentIds: [up.body.id],
    });
    expect(reg.body.flags).toEqual(["EXCEPTION"]);
    expect(s.post("admin", `/registrations/${reg.body.id}/reject`, {}).body.fieldErrors).toEqual({
      reason: "validation.reasonRequired",
    });
    expect(
      s.post("admin", `/registrations/${reg.body.id}/reject`, { reason: "Unreadable invoice." }).body,
    ).toMatchObject({
      status: "REJECTED",
      rejectReason: "Unreadable invoice.",
    });
    expect(s.get("customer", "/notifications").body[0]).toMatchObject({ key: "registration_rejected" });
  });

  it("public web form: no account, proof of purchase required, waits in the inbox", () => {
    const s = setup();
    const fields = {
      serial: "263899002",
      batchNumber: "2638-L02",
      modelCode: "VP87",
      purchaseDate: TODAY,
      customerName: "Jordan Lee",
      customerEmail: "jordan.lee@example.com",
      state: "CA",
      zip: "92612",
    };
    expect(s.post(null, "/public/registrations", {}).status).toBe(422);
    const bad = s.post(
      null,
      "/public/registrations",
      { ...fields, zip: "926", customerEmail: "nope" },
      { file: JPEG },
    );
    expect(bad.body.fieldErrors).toEqual({ zip: "validation.zip", customerEmail: "validation.email" });

    const ok = s.post(null, "/public/registrations", fields, { file: JPEG });
    expect(ok.body).toEqual({ registrationId: expect.stringMatching(/^REG-/), status: "PENDING" });
    const inbox = s.get("admin", `/registrations/${ok.body.registrationId}`).body;
    expect(inbox).toMatchObject({
      channel: "WEB",
      flags: ["EXCEPTION"],
      submittedByName: "Web form: Jordan Lee",
      customer: { name: "Jordan Lee", state: "CA", zip: "92612" },
    });
    expect(inbox.attachmentIds).toHaveLength(1);
    expect(s.get("admin", `/files/${inbox.attachmentIds[0]}`).download?.data).toEqual(JPEG.data);
    s.post("admin", `/registrations/${ok.body.registrationId}/approve`);
    const crm = s.get("admin", "/integrations?system=CRM");
    expect(crm.body.items.some((m: { refId: string }) => m.refId === ok.body.registrationId)).toBe(true);

    const bot = s.post(
      null,
      "/public/registrations",
      { ...fields, serial: "263899009", website: "http://spam" },
      { file: JPEG },
    );
    expect(bot.status).toBe(200);
    expect(s.get("admin", "/registrations?q=263899009").body.total).toBe(0);
  });

  it("partner API: clean items registered at once, duplicates reviewed, errors returned per item", () => {
    const s = setup();
    const partner = (key: string, body: unknown) =>
      s.post(null, "/partner/v1/registrations", body, { headers: { "x-api-key": key } });
    const res = partner(DEMO_PARTNER_KEYS["pc-desertpeak-pos"], {
      registrations: [
        {
          serial: "263899003",
          batchNumber: "2638-L01",
          modelCode: "SC260",
          purchaseDate: TODAY,
          customer: { name: "Pat Moreno", state: "AZ" },
        },
        {
          serial: "SC680-251406233",
          batchNumber: "2514-L01",
          modelCode: "SC680",
          purchaseDate: TODAY,
          customer: { name: "Someone" },
        },
        {
          serial: "263899003",
          batchNumber: "2638-L01",
          modelCode: "SC260",
          purchaseDate: TODAY,
          customer: { name: "Repeat" },
        },
        { serial: "x" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "REGISTERED",
      "REVIEW",
      "REVIEW",
      "ERROR",
    ]);
    expect(s.get("admin", "/units/SC260-263899003").body).toMatchObject({
      dealerId: "d-desertpeak",
      status: "ACTIVE",
    });
    expect(s.get("admin", `/registrations/${res.body.results[0].registrationId}`).body.channel).toBe("API");
    expect(s.get("admin", "/integrations?type=x&q=partner_registration").body.items[0]).toMatchObject({
      system: "PARTNER",
      payload: { received: 4, registered: 1, review: 2, errors: 1 },
    });

    const retail = partner(DEMO_PARTNER_KEYS["pc-marketplace"], {
      serial: "263899006",
      batchNumber: "2638-L02",
      modelCode: "SRS1",
      purchaseDate: TODAY,
      customer: { name: "Nina Patel", email: "nina@example.com" },
    });
    expect(retail.body.results[0].status).toBe("REGISTERED");
    expect(s.get("admin", "/units/SRS1-263899006").body).toMatchObject({
      placeOfPurchase: "Online marketplace",
      registrationChannel: "RETAIL",
    });

    // Fieldpiece's apps use the same API with their own keys; the registration gets the app's channel.
    const app = partner(DEMO_PARTNER_KEYS["pc-joblink"], {
      serial: "263899021",
      batchNumber: "2638-L02",
      modelCode: "JL3PR",
      purchaseDate: TODAY,
      customer: { name: "Dana Whitaker", email: "dana.whitaker@example.com", state: "TX", zip: "77002" },
    });
    expect(app.body.results[0].status).toBe("REGISTERED");
    expect(s.get("admin", `/registrations/${app.body.results[0].registrationId}`).body).toMatchObject({
      channel: "JOBLINK",
      status: "APPROVED",
      submittedByName: "Fieldpiece Job Link",
    });
    expect(s.get("admin", "/units/JL3PR-263899021").body).toMatchObject({
      status: "ACTIVE",
      registrationChannel: "JOBLINK",
    });
    expect(s.get("admin", "/units/JL3PR-263899021").body.dealerId).toBeUndefined();
    const again = partner(DEMO_PARTNER_KEYS["pc-overwatch"], {
      serial: "JL3PR-263899021",
      batchNumber: "2638-L02",
      modelCode: "JL3PR",
      purchaseDate: TODAY,
      customer: { name: "Someone Else" },
    });
    expect(again.body.results[0].status).toBe("REVIEW");
    expect(s.get("admin", `/registrations/${again.body.results[0].registrationId}`).body).toMatchObject({
      channel: "OVERWATCH",
      status: "PENDING",
      flags: ["DUPLICATE", "EXCEPTION"],
    });

    expect([partner("fpk_wrong", {}).status, partner("fpk_wrong", {}).body.code]).toEqual([
      401,
      "invalid_api_key",
    ]);
    const created = s.post("admin", "/admin/partner-clients", { name: "Retail chain", channel: "RETAIL" });
    expect(created.status).toBe(201);
    expect(
      s.post("admin", "/admin/partner-clients", { name: "Job Link (test)", channel: "JOBLINK" }).body.client,
    ).toMatchObject({ channel: "JOBLINK" });
    expect(created.body.apiKey).toMatch(/^fpk_/);
    expect(created.body.client).toMatchObject({ active: true, keyPrefix: created.body.apiKey.slice(0, 12) });
    expect(JSON.stringify(s.get("admin", "/admin/partner-clients").body)).not.toContain(created.body.apiKey);
    expect(s.post("admin", "/admin/partner-clients", { channel: "FAX" }).body.fieldErrors).toEqual({
      name: "validation.required",
      channel: "validation.channel",
    });
    const off = s.call("admin", "PATCH", `/admin/partner-clients/${created.body.client.id}`, {
      body: { active: false },
    });
    expect(off.body.active).toBe(false);
    expect(partner(created.body.apiKey, {}).status).toBe(401);
    const clients = s.get("admin", "/admin/partner-clients").body as {
      id: string;
      channel: string;
      lastUsedAt?: string;
    }[];
    expect(clients[0]!.lastUsedAt).toBeDefined();
    expect(clients.slice(0, 4).map((c) => [c.id, c.channel])).toEqual([
      ["pc-desertpeak-pos", "API"],
      ["pc-marketplace", "RETAIL"],
      ["pc-overwatch", "OVERWATCH"],
      ["pc-joblink", "JOBLINK"],
    ]);
  });

  it("email intake: reads the registration from the message, keeps the attachment, needs the shared secret", () => {
    const s = setup();
    const email = {
      from: "Renee Carter <renee.carter@example.com>",
      subject: "Register my gauge",
      text: "Model: MG44\nSerial number: 263899004\nBatch: 2638-L03\nPurchased: 09/20/2026\nState: LA",
      attachments: [
        { filename: "receipt.jpg", contentType: "image/jpeg", contentBase64: btoa("\xff\xd8\xff\xe0") },
      ],
    };
    const inbound = (secret: string, body: unknown) =>
      s.post(null, "/inbound/email", body, { headers: { "x-inbound-secret": secret } });
    expect(inbound("wrong", email).status).toBe(401);
    const res = inbound(SECRET, email);
    expect(res.status).toBe(202);
    const reg = s.get("admin", `/registrations/${res.body.registrationId}`).body;
    expect(reg).toMatchObject({
      channel: "EMAIL",
      serial: "MG44-263899004",
      batchNumber: "2638-L03",
      modelCode: "MG44",
      purchaseDate: "2026-09-20",
      customer: { name: "Renee Carter", email: "renee.carter@example.com", state: "LA" },
    });
    expect(reg.attachmentIds).toHaveLength(1);
    // Renee is an existing customer (same email): approval links the product to her record.
    s.post("admin", `/registrations/${reg.id}/approve`);
    expect(s.get("admin", "/units/MG44-263899004").body.customerId).toBe("c-rcarter");

    expect(inbound(SECRET, { from: "x@example.com", text: "hello" }).body.status).toBe("IGNORED");
    expect(s.get("admin", "/integrations?system=EMAIL&status=FAILED").body.total).toBe(1);

    s.db.inboundEmailSecret = undefined;
    expect(inbound(SECRET, email).status).toBe(404);
  });

  it("tells dealers and distributors where registrations come in", () => {
    const s = setup();
    expect(s.get("dealer", "/intake").body).toEqual({
      publicFormPath: "/register-product",
      inboundEmail: "registrations@wms.local",
      partnerApiPath: "/api/partner/v1",
    });
  });
});

describe("warranty claims", () => {
  it("a covered claim approved as a replacement moves the rest of the warranty to the new serial", () => {
    const s = setup();
    expect(s.get("customer", "/units/SC680-251406233/coverage").body).toMatchObject({
      covered: true,
      reason: "IN_WARRANTY",
    });
    const filed = s.post("customer", "/claims", {
      unitSerial: "SC680-251406233",
      issueType: "DISPLAY",
      description: "Backlight flickers and the reading freezes.",
    });
    expect(filed.body).toMatchObject({
      status: "SUBMITTED",
      source: "CUSTOMER",
      raisedByName: "Marcus Reed",
      coverage: { covered: true },
      batchNumber: "2514-L01",
      modelCode: "SC680",
      warrantyStatus: "ACTIVE",
    });
    const again = s.post("customer", "/claims", {
      unitSerial: "SC680-251406233",
      issueType: "DISPLAY",
      description: "Filing the same problem twice.",
    });
    expect([again.status, again.body.code]).toEqual([409, "claim_open"]);
    expect(s.post("customer", "/claims", { unitSerial: "SC680-251406233" }).body.fieldErrors).toEqual({
      issueType: "validation.issueType",
      description: "validation.describeFault",
    });
    expect(
      s.post("admin", "/claims", {
        unitSerial: "SM482V-261804517",
        issueType: "OTHER",
        description: "Not registered yet.",
      }).body.code,
    ).toBe("not_registered");

    const id = filed.body.id as string;
    expect(s.move(id, { action: "approve", resolution: "REPAIR" }).body.code).toBe("invalid_transition");
    s.move(id, { action: "start_review" });
    expect(s.move(id, { action: "approve" }).body.fieldErrors).toEqual({
      resolution: "validation.resolution",
    });
    s.move(id, { action: "approve", resolution: "REPLACE", note: "Display fault confirmed." });
    expect(s.move(id, { action: "close" }).body.fieldErrors).toEqual({
      replacementSerial: "validation.required",
    });
    expect(s.move(id, { action: "close", replacementSerial: "SC680-252409963" }).body.code).toBe(
      "duplicate_serial",
    );
    const closed = s.move(id, {
      action: "close",
      replacementSerial: "263899005",
      replacementBatchNumber: "2638-L02",
    });
    expect(closed.body).toMatchObject({
      status: "CLOSED",
      resolution: "REPLACE",
      replacementSerial: "SC680-263899005",
    });
    expect(closed.body.history.map((e: { status: string }) => e.status)).toEqual([
      "SUBMITTED",
      "IN_REVIEW",
      "APPROVED",
      "CLOSED",
    ]);

    const original = s.get("customer", "/units/SC680-251406233").body;
    const replacement = s.get("customer", "/units/SC680-263899005").body;
    expect(original).toMatchObject({ status: "EXPIRED", replacedBySerial: "SC680-263899005" });
    expect(replacement).toMatchObject({
      status: "ACTIVE",
      replacesSerial: "SC680-251406233",
      warrantyEnd: original.warrantyEnd,
      warrantyStart: TODAY,
      batchNumber: "2638-L02",
    });
    expect(original.history.map((e: { type: string }) => e.type).slice(-3)).toEqual([
      "claim_filed",
      "replaced",
      "claim_closed",
    ]);
    expect(s.get("customer", "/notifications").body.map((n: { key: string }) => n.key)).toEqual(
      expect.arrayContaining(["claim_approved", "claim_closed"]),
    );
    expect(s.get("admin", "/notifications").body[0]).toMatchObject({ key: "claim_submitted" });
  });

  it("a credit is posted to Finance; a rejection needs a reason; dealers and customers can't decide", () => {
    const s = setup();
    const filed = s.post("dealer", "/claims", {
      unitSerial: "MG44-252811902",
      issueType: "CONNECTIVITY",
      description: "Gauge drops the Bluetooth link every few minutes.",
    });
    expect(filed.body.source).toBe("DEALER");
    const id = filed.body.id as string;
    expect(s.post("dealer", `/claims/${id}/transitions`, { action: "start_review" }).status).toBe(403);
    s.move(id, { action: "start_review" });
    expect(s.move(id, { action: "approve", resolution: "CREDIT" }).body.fieldErrors).toEqual({
      creditAmount: "validation.amount",
    });
    expect(
      s.move(id, { action: "approve", resolution: "CREDIT", creditAmount: 249.5 }).body.creditAmount,
    ).toBe(249.5);
    s.move(id, { action: "close" });
    const finance = s.get("admin", "/integrations?system=FINANCE");
    expect(finance.body.items.find((m: { refId: string }) => m.refId === id)).toMatchObject({
      type: "credit_memo",
      direction: "OUT",
      payload: { amount: 249.5, currency: "USD", model: "MG44" },
    });

    const expired = s.post("customer", "/claims", {
      unitSerial: "VP87-243208841",
      issueType: "MECHANICAL",
      description: "Pump motor stalls after a minute.",
    });
    expect(expired.body.coverage).toMatchObject({ covered: false, reason: "EXPIRED" });
    expect(s.move(expired.body.id, { action: "reject" }).body.fieldErrors).toEqual({
      reason: "validation.reasonRequired",
    });
    expect(
      s.move(expired.body.id, { action: "reject", reason: "Out of warranty. Repair quote sent." }).body,
    ).toMatchObject({
      status: "REJECTED",
      rejectReason: "Out of warranty. Repair quote sent.",
    });
    expect(s.get("customer", `/claims/${expired.body.id}`).body.status).toBe("REJECTED");
    expect(s.move("CLM-9999", { action: "start_review" }).status).toBe(404);
  });

  it("W5: a voided product's claim is filed as not covered", () => {
    const s = setup();
    const voided = s.post("admin", "/units/DR82-252207119/void", {
      reason: "UNAUTHORIZED_REPAIR",
      note: "Tamper label broken.",
    });
    expect(voided.body).toMatchObject({
      status: "VOID",
      void: { reason: "UNAUTHORIZED_REPAIR", byName: "Warranty Desk" },
    });
    expect(s.post("admin", "/units/DR82-252207119/void", { reason: "NOPE" }).body.fieldErrors).toEqual({
      reason: "validation.voidReason",
    });
    expect(s.post("admin", "/units/DR82-252207119/void", { reason: "MISUSE" }).body.code).toBe(
      "already_void",
    );
    expect(s.post("admin", "/units/SM482V-261804517/void", { reason: "MISUSE" }).body.code).toBe(
      "not_registered",
    );
    const claim = s.post("customer", "/claims", {
      unitSerial: "DR82-252207119",
      issueType: "INACCURATE_READING",
      description: "Detector alarms with no leak present.",
    });
    expect(claim.body.coverage).toMatchObject({ covered: false, reason: "VOID" });
    expect(claim.body.warrantyStatus).toBe("VOID");
    expect(s.get("customer", "/notifications").body.map((n: { key: string }) => n.key)).toContain(
      "unit_voided",
    );
  });

  it("filters and searches claims", () => {
    const s = setup();
    expect(s.get("admin", "/claims?status=CLOSED").body.total).toBe(25);
    expect(s.get("admin", "/claims?q=2427-L01").body.items.map((c: { id: string }) => c.id)).toEqual([
      "CLM-1004",
    ]);
    const mechanical = s.get("admin", "/claims?issueType=MECHANICAL&sort=createdAt&pageSize=100").body
      .items as { id: string; issueType: string; createdAt: string }[];
    expect(mechanical.every((c) => c.issueType === "MECHANICAL")).toBe(true);
    expect(mechanical.map((c) => c.createdAt)).toEqual(mechanical.map((c) => c.createdAt).sort());
    expect(mechanical.map((c) => c.id).filter((id) => id === "CLM-1006" || id === "CLM-1007")).toEqual([
      "CLM-1006",
      "CLM-1007",
    ]);
    expect(s.get("admin", "/claims?pageSize=2&page=2").body).toMatchObject({
      total: 53,
      page: 2,
      pageSize: 2,
    });
  });
});

describe("system events, dashboards, reset", () => {
  it("W6: ERP, email and marketplace intake land where they should; approving the email updates CRM", () => {
    const s = setup();
    const erp = s.post("admin", "/simulate/erp-invoice");
    expect(
      erp.body.map(
        (r: { channel: string; status: string; flags: string[] }) =>
          `${r.channel}:${r.status}:${r.flags.length}`,
      ),
    ).toEqual(["ERP:PENDING:0", "ERP:PENDING:0", "ERP:PENDING:0"]);
    expect(new Set(erp.body.map((r: { serial: string }) => r.serial)).size).toBe(3);
    const mail = s.post("admin", "/simulate/registration-email");
    expect(mail.body).toMatchObject({ channel: "EMAIL", status: "PENDING", modelCode: "SC680" });
    expect(mail.body.attachmentIds).toHaveLength(1);
    const invoice = s.get("admin", `/files/${mail.body.attachmentIds[0]}`).download!;
    expect(invoice.mime).toBe("application/pdf");
    expect(new TextDecoder().decode(invoice.data as Uint8Array).slice(0, 5)).toBe("%PDF-");
    const market = s.post("admin", "/simulate/marketplace-order");
    expect(market.body.map((r: { channel: string; status: string }) => `${r.channel}:${r.status}`)).toEqual([
      "RETAIL:APPROVED",
      "RETAIL:APPROVED",
    ]);

    const bulk = s.post("admin", "/registrations/bulk-approve", {
      ids: [...erp.body.map((r: { id: string }) => r.id), "REG-9999"],
    });
    expect(bulk.body).toEqual({ approved: 3, skipped: 1 });
    s.post("admin", `/registrations/${mail.body.id}/approve`);
    const crm = s.get("admin", "/integrations?system=CRM&direction=OUT");
    expect(crm.body.items.some((m: { refId: string }) => m.refId === mail.body.id)).toBe(true);
    expect(s.get("admin", "/notifications").body.map((n: { key: string }) => n.key)).toEqual(
      expect.arrayContaining(["erp_invoice_received", "registration_submitted"]),
    );
  });

  it("retries only failed integration messages", () => {
    const s = setup();
    const failed = s.get("admin", "/integrations?status=FAILED").body.items[0];
    expect(failed).toMatchObject({ system: "CRM", attempts: 1 });
    expect(s.post("admin", `/integrations/${failed.id}/retry`).body).toMatchObject({
      status: "SUCCESS",
      attempts: 2,
    });
    expect(s.post("admin", `/integrations/${failed.id}/retry`).body.code).toBe("not_failed");
  });

  it("W7: the distributor's dashboard covers both dealers and narrows to one", () => {
    const s = setup();
    const all = s.get("distributor", "/dashboard/summary").body;
    expect(all.dealers.map((d: { dealerId: string }) => d.dealerId)).toEqual(["d-lonestar", "d-bayou"]);
    expect(all.openClaims).toBe(9);
    expect(s.get("distributor", "/dashboard/summary?dealerId=d-bayou").body.openClaims).toBe(5);
    expect(s.get("distributor", "/dashboard/summary?dealerId=d-desertpeak").body).toMatchObject({
      registrationsThisMonth: 0,
      openClaims: 0,
    });
    expect(s.get("customer", "/dashboard/summary").body).toEqual({
      role: "customer",
      units: 8,
      active: 6,
      expiringSoon: 1,
      openClaims: 0,
      unitsByStatus: [
        { status: "ACTIVE", count: 6 },
        { status: "EXPIRING_SOON", count: 1 },
        { status: "EXPIRED", count: 1 },
        { status: "VOID", count: 0 },
        { status: "PENDING", count: 0 },
      ],
    });
  });

  it("dashboard cards add up to the product list, and the list's status matches every product's own", () => {
    const s = setup();
    for (const days of [0, 30, 200, 900]) {
      s.db.today = () => addDaysIso(TODAY, days);
      const d = s.get("admin", "/dashboard/summary").body;
      const list = s.allUnits("admin");
      expect(d.units).toBe(list.total);
      expect(list.items).toHaveLength(list.total);
      expect(d.active + d.expiring30 + d.expired + d.pending + d.voided).toBe(d.units);
      for (const status of ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "PENDING"]) {
        const filtered = s
          .allUnits("admin", `&status=${status}`)
          .items.map((u) => u.serial)
          .sort();
        const expected = list.items
          .filter((u) => u.status === status)
          .map((u) => u.serial)
          .sort();
        expect([days, status, filtered]).toEqual([days, status, expected]);
      }
    }
  });

  it("reports the admin dashboard from the seed", () => {
    const s = setup();
    const d = s.get("admin", "/dashboard/summary").body;
    expect(d).toMatchObject({
      role: "admin",
      units: 267,
      active: 174,
      expiring30: 27,
      expired: 47,
      pending: 13,
      voided: 6,
      openClaims: 20,
      pendingRegistrations: 15,
    });
    expect(d.registrationsByChannel.map((c: { channel: string }) => c.channel)).toEqual([
      "DEALER",
      "PORTAL",
      "WEB",
      "EMAIL",
      "ERP",
      "API",
      "RETAIL",
      "OVERWATCH",
      "JOBLINK",
    ]);
    // Approved registrations: dealer entries and bulk uploads together, then each channel.
    expect(d.registrationsByChannel.map((c: { count: number }) => c.count)).toEqual([
      112, 22, 15, 9, 11, 24, 7, 20, 30,
    ]);
    expect(d.claimsByStatus.find((c: { status: string }) => c.status === "CLOSED").count).toBe(25);
    expect(d.claimsByCategory.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(53);
    expect(d.recentActivity).toHaveLength(8);
  });

  it("reports the products registered from Fieldpiece's apps", () => {
    const s = setup();
    const apps = s.get("admin", "/dashboard/summary").body.apps as Record<string, number | string>[];
    expect(apps).toEqual([
      {
        channel: "OVERWATCH",
        units: 20,
        active: 15,
        expiringSoon: 1,
        expired: 4,
        last30Days: 1,
        claims: 5,
        pendingRegistrations: 1,
      },
      {
        channel: "JOBLINK",
        units: 30,
        active: 22,
        expiringSoon: 1,
        expired: 6,
        last30Days: 6,
        claims: 3,
        pendingRegistrations: 1,
      },
    ]);
    // The same products the list shows for the channel.
    for (const app of apps) {
      const list = s.allUnits("admin", `&channel=${app.channel}`);
      expect([app.channel, list.total]).toEqual([app.channel, app.units]);
      expect(list.items.every((u) => u.registrationChannel === app.channel)).toBe(true);
    }
    expect(s.units("admin", "&channel=APPS").total).toBe(50);
    expect(s.units("admin", "&channel=FAX").total).toBe(267); // not a channel: no filter
    expect(s.units("dealer", "&channel=APPS").total).toBe(0); // the apps register without a dealer
    expect(s.units("customer", "&channel=APPS").items.map((u) => u.serial)).toEqual(["SC440-263473208"]);
    expect(s.units("customer", "&channel=PORTAL").items.map((u) => u.serial)).toEqual([
      "DR82-252207119",
      "JL3KR4-252479315",
    ]);
    // The channel of the registration that started the warranty; none before registration or for a replacement.
    expect(s.get("admin", "/units/SC680-251406233").body.registrationChannel).toBe("DEALER");
    expect(s.get("admin", "/units/SM482V-261804517").body.registrationChannel).toBeUndefined();
    expect(s.get("admin", "/units/SM382V-252707701").body.registrationChannel).toBeUndefined();
    // Dealers, distributors and customers don't get the figures.
    expect(s.get("dealer", "/dashboard/summary").body.apps).toBeUndefined();
    expect(s.get("customer", "/dashboard/summary").body.apps).toBeUndefined();
  });

  it("gives every dealer registrations this month", () => {
    const s = setup();
    for (const who of ["dealer", "bayou", "desertpeak"] as const) {
      const d = s.get(who, "/dashboard/summary").body;
      expect([who, d.registrationsThisMonth > 0, d.dealers[0].registrationsThisMonth > 0]).toEqual([
        who,
        true,
        true,
      ]);
    }
    expect(s.get("distributor", "/dashboard/summary").body.registrationsThisMonth).toBeGreaterThan(0);
  });

  it("A13: Job Link and Overwatch register new products through the partner API with their own channels", () => {
    const s = setup();
    const joblink = s.post("admin", "/simulate/joblink-registration");
    expect(joblink.status).toBe(200);
    expect(
      joblink.body.map(
        (r: { channel: string; status: string; modelCode: string }) =>
          `${r.channel}:${r.status}:${r.modelCode}`,
      ),
    ).toEqual(["JOBLINK:APPROVED:JL3KH6", "JOBLINK:APPROVED:MG44"]);
    expect(joblink.body[0]).toMatchObject({
      submittedByName: "Fieldpiece Job Link",
      customer: { name: "Owen Castillo" },
    });
    expect(joblink.body[0].dealerId).toBeUndefined();
    const overwatch = s.post("admin", "/simulate/overwatch-registration");
    expect(
      overwatch.body.map((r: { channel: string; status: string }) => `${r.channel}:${r.status}`),
    ).toEqual(["OVERWATCH:APPROVED"]);
    expect(s.get("admin", `/units/${overwatch.body[0].serial}`).body).toMatchObject({
      status: "ACTIVE",
      registrationChannel: "OVERWATCH",
    });
    const apps = s.get("admin", "/dashboard/summary").body.apps as {
      channel: string;
      units: number;
      last30Days: number;
    }[];
    expect(apps.map((a) => [a.channel, a.units, a.last30Days])).toEqual([
      ["OVERWATCH", 21, 2],
      ["JOBLINK", 32, 8],
    ]);
    expect(s.get("admin", "/integrations?q=pc-joblink").body.items[0]).toMatchObject({
      system: "PARTNER",
      type: "partner_registration",
      payload: { channel: "JOBLINK", registered: 2 },
    });
    expect(s.post("customer", "/simulate/joblink-registration").status).toBe(403);
    expect(s.post("dealer", "/simulate/overwatch-registration").status).toBe(403);
  });

  it("resets the data and keeps signed-in users signed in", () => {
    const s = setup();
    s.post("admin", "/simulate/erp-invoice");
    expect(s.post("admin", "/simulate/reset").body).toEqual({ ok: true });
    expect(s.get("admin", "/registrations?channel=ERP&status=PENDING").body.total).toBe(0);
    expect(s.get("dealer", "/units?pageSize=1").status).toBe(200);
  });

  it("undoes every change of a request that fails", () => {
    const s = setup();
    // A web form registration has no customer record yet: approving creates one, then fails on the unknown model.
    const reg = s.post(
      null,
      "/public/registrations",
      {
        serial: "263899012",
        modelCode: "SC680",
        purchaseDate: TODAY,
        customerName: "Jordan Lee",
        customerEmail: "jordan.lee@example.com",
      },
      { file: JPEG },
    );
    s.db.state.registrations.find((r) => r.id === reg.body.registrationId)!.modelCode = "GONE";
    const before = JSON.stringify(s.db.state);
    expect(s.post("admin", `/registrations/${reg.body.registrationId}/approve`).body.code).toBe(
      "unknown_model",
    );
    expect(JSON.stringify(s.db.state)).toBe(before);
  });
});

describe("extended warranties and finance", () => {
  it("quotes and sells an extended warranty to the customer, up to 36 months in total", () => {
    const s = setup();
    const serial = "SC680-251406233";
    const before = s.get("customer", `/units/${serial}`).body;
    expect(before.extensions).toEqual([]);
    const quote = s.get("customer", `/units/${serial}/extension`).body;
    expect(quote).toMatchObject({ eligible: true, currentEnd: before.warrantyEnd, extendedMonths: 0 });
    expect(quote.options).toEqual([
      { months: 12, price: 48.99, newEnd: addMonthsIso(before.warrantyEnd, 12) },
      { months: 24, price: 85.99, newEnd: addMonthsIso(before.warrantyEnd, 24) },
      { months: 36, price: 114.99, newEnd: addMonthsIso(before.warrantyEnd, 36) },
    ]);

    const bought = s.post("customer", `/units/${serial}/extensions`, { months: 12 });
    expect(bought.status).toBe(200);
    expect(bought.body).toMatchObject({
      warrantyEnd: addMonthsIso(before.warrantyEnd, 12),
      status: "ACTIVE",
    });
    expect(bought.body.extensions).toEqual([
      expect.objectContaining({
        id: "EXT-1019",
        months: 12,
        price: 48.99,
        previousEnd: before.warrantyEnd,
        soldBy: "u-mreed",
        dealerId: "d-lonestar",
      }),
    ]);
    expect(bought.body.history.at(-1)).toMatchObject({ type: "extended", refId: "EXT-1019" });
    expect(s.get("dealer", "/notifications").body[0]).toMatchObject({
      key: "unit_extended",
      params: { serial, months: 12 },
    });
    const finance = s.get("admin", "/integrations?system=FINANCE").body.items;
    expect(finance.find((m: { refId: string }) => m.refId === "EXT-1019")).toMatchObject({
      type: "extension_invoice",
      payload: { serial, model: "SC680", months: 12, price: 48.99 },
    });

    const left = s.get("customer", `/units/${serial}/extension`).body.options;
    expect(left.map((o: { months: number }) => o.months)).toEqual([12, 24]);
    expect(s.post("customer", `/units/${serial}/extensions`, { months: 36 }).body.fieldErrors).toEqual({
      months: "validation.extensionPlan",
    });
    expect(s.post("customer", `/units/${serial}/extensions`, { months: 24 }).status).toBe(200);
    const full = s.post("customer", `/units/${serial}/extensions`, { months: 12 });
    expect([full.status, full.body.code]).toEqual([409, "not_extendable"]);
    expect(s.get("customer", `/units/${serial}/extension`).body).toMatchObject({
      eligible: false,
      reason: "LIMIT_REACHED",
      extendedMonths: 36,
    });
  });

  it("credits the selling dealer, scopes the offer and refuses products that can't be extended", () => {
    const s = setup();
    const sold = s.post("dealer", "/units/MG44-252811902/extensions", { months: 24 });
    expect(sold.body.extensions[0]).toMatchObject({
      soldBy: "u-lonestar",
      dealerId: "d-lonestar",
      price: 48.99,
    });
    expect(s.get("bayou", "/units/MG44-252811902/extension").status).toBe(404);
    expect(s.post("bayou", "/units/MG44-252811902/extensions", { months: 12 }).status).toBe(404);
    expect(s.get("customer", "/units/MG44-252811902/extension").status).toBe(404);

    const refused = (who: Who, serial: string) => {
      const res = s.post(who, `/units/${serial}/extensions`, { months: 12 });
      return [res.status, res.body.code, s.get(who, `/units/${serial}/extension`).body.reason];
    };
    expect(refused("customer", "VP87-243208841")).toEqual([409, "not_extendable", "EXPIRED"]);
    expect(refused("admin", "SM482V-261804517")).toEqual([409, "not_extendable", "NOT_REGISTERED"]);
    expect(refused("admin", "SM382V-252005531")).toEqual([409, "not_extendable", "REPLACED"]);
    s.post("admin", "/units/DR82-252207119/void", { reason: "MISUSE" });
    expect(refused("customer", "DR82-252207119")).toEqual([409, "not_extendable", "VOID"]);
    expect(s.post("admin", "/units/SC680-252409963/extensions", { months: 6 }).body.fieldErrors).toEqual({
      months: "validation.extensionPlan",
    });
  });

  it("shows a model's internal finance figures to the warranty desk only", () => {
    const s = setup();
    const internal = ["repairCost", "warrantyBudget", "claimQuota"];
    const sc680 = (models: { code: string }[]) =>
      models.find((m) => m.code === "SC680") as Record<string, unknown>;
    expect(sc680(s.get("admin", "/models").body)).toMatchObject({
      listPrice: 329,
      repairCost: 99,
      claimQuota: 3,
    });
    for (const who of ["dealer", "customer", null] as const) {
      const model = sc680(s.get(who, who ? "/models" : "/public/models").body);
      expect(model.listPrice).toBe(329);
      expect(internal.filter((f) => f in model)).toEqual([]);
    }
  });

  it("reports warranty cost against budget, scoped to the caller's dealers", () => {
    const s = setup();
    const admin = s.get("admin", "/dashboard/finance").body;
    expect(admin).toMatchObject({
      currency: "USD",
      periodStart: "2025-09-29",
      periodEnd: TODAY,
      warrantyCost: 5596.45,
      creditsIssued: 1657.25,
      extensionRevenue: 1595.82,
      extensionsSold: 18,
      netWarrantyCost: 4000.63,
      // Models with registered products: sum of round(list price x 2.5).
      budget: 67701,
      budgetUsedPct: 8,
      averageClaimCost: 174.89,
      costByResolution: [
        { resolution: "REPAIR", amount: 2265, count: 18 },
        { resolution: "REPLACE", amount: 1674.2, count: 6 },
        { resolution: "CREDIT", amount: 1657.25, count: 8 },
      ],
    });
    expect(admin.costByCategory).toHaveLength(11); // every category, zero allowed
    expect(admin.monthly).toHaveLength(12);
    expect(admin.monthly.at(-1).month).toBe("2026-09");
    expect(admin.monthly.reduce((n: number, m: { cost: number }) => n + m.cost, 0)).toBeCloseTo(5596.45);
    expect(admin.quotas.map((q: { modelCode: string }) => q.modelCode).slice(0, 4)).toEqual([
      "SC640",
      "SC260",
      "MG44",
      "VP87",
    ]);
    expect(admin.quotas[0]).toMatchObject({
      units: 5,
      budget: 498,
      spent: 358.2,
      budgetUsedPct: 72,
      claims: 3,
    });

    expect(s.get("dealer", "/dashboard/finance").body).toMatchObject({
      warrantyCost: 2622.65,
      extensionRevenue: 631.93,
      extensionsSold: 7,
      budget: 46443,
      creditsIssued: 1010.25,
    });
    expect(s.get("distributor", "/dashboard/finance?dealerId=d-bayou").body).toMatchObject({
      warrantyCost: 1584.4,
      extensionsSold: 2,
    });
    expect(s.get("distributor", "/dashboard/finance?dealerId=d-desertpeak").body).toMatchObject({
      warrantyCost: 0,
      budget: 0,
      quotas: [],
    });
    expect(s.get("customer", "/dashboard/finance").status).toBe(403);
  });

  it("lets the warranty desk set a model's price and quota", () => {
    const s = setup();
    const patch = (who: Who, id: string, body: unknown) => s.call(who, "PATCH", `/models/${id}`, { body });
    expect(patch("admin", "m-sc680", { listPrice: 349.5, claimQuota: 5 }).body).toMatchObject({
      code: "SC680",
      listPrice: 349.5,
      repairCost: 99,
      warrantyBudget: 823,
      claimQuota: 5,
      categoryName: "Clamp meters",
    });
    const models = s.get("dealer", "/models").body as { id: string; listPrice: number }[];
    expect(models.find((m) => m.id === "m-sc680")?.listPrice).toBe(349.5);
    const bad = patch("admin", "m-sc680", { repairCost: -1, warrantyBudget: 1.234, claimQuota: 2.5 });
    expect([bad.status, bad.body.fieldErrors]).toEqual([
      422,
      {
        repairCost: "validation.amount",
        warrantyBudget: "validation.amount",
        claimQuota: "validation.quota",
      },
    ]);
    expect(patch("admin", "m-nope", { listPrice: 1 }).status).toBe(404);
    expect(patch("dealer", "m-sc680", { listPrice: 1 }).status).toBe(403);
  });

  it("adds status counts and 12-month trends to the dashboards", () => {
    const s = setup();
    const admin = s.get("admin", "/dashboard/summary").body;
    expect(admin.trend).toHaveLength(12);
    expect(admin.trend[0].month).toBe("2025-10");
    expect(admin.trend.at(-1).month).toBe("2026-09");
    expect(admin.trend.reduce((n: number, m: { claims: number }) => n + m.claims, 0)).toBe(53);

    const dealer = s.get("dealer", "/dashboard/summary").body;
    expect(dealer.unitsByStatus.map((c: { status: string }) => c.status)).toEqual([
      "ACTIVE",
      "EXPIRING_SOON",
      "EXPIRED",
      "VOID",
      "PENDING",
    ]);
    expect(dealer.unitsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(
      s.units("dealer").total,
    );
    expect(dealer.claimsByStatus).toHaveLength(5);
    expect(dealer.claimsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(18);
    expect(dealer.trend.reduce((n: number, m: { claims: number }) => n + m.claims, 0)).toBe(18);
    const bayou = s.get("distributor", "/dashboard/summary?dealerId=d-bayou").body;
    expect(bayou.unitsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(63);
    expect(bayou.claimsByStatus.find((c: { status: string }) => c.status === "CLOSED").count).toBe(8);
  });
});
