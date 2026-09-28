import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_PARTNER_KEYS } from "../../src/modules/demo/seed-data";
import { createHarness, type Harness, JPEG, type Session, type Who } from "../setup/harness";

// The warranty workflows (frontend/docs/demo-workflows.md) through the API, plus what a mock server can't show:
// concurrent changes and the SQL status matching the shared warranty rules.

describe("workflows", () => {
  let h: Harness;
  const s = {} as Record<Who, Session>;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(async () => {
    await h.reseed();
    for (const who of ["admin", "dealer", "distributor", "customer"] as const) s[who] = await h.login(who);
  });
  afterAll(() => h.close());

  const call = (who: Who, method: "GET" | "POST" | "PUT", url: string, body?: unknown) =>
    h.request({ method, url, as: s[who], body });
  const move = (id: string, body: Record<string, unknown>) =>
    call("admin", "POST", `/claims/${id}/transitions`, body);

  // ── Registration entry points ─────────────────────────────────────────────

  it("W1: bulk import registers clean rows, sends the duplicate to review, and re-checks fixed rows in place", async () => {
    const file = readFileSync(join(__dirname, "../../../demo-assets/lonestar_sales_week38.xlsx"));
    const up = await h.upload(s.dealer, "/bulk-imports", {
      name: "lonestar_sales_week38.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: file,
    });
    expect(up.status).toBe(201);
    expect(up.body.counts).toEqual({ total: 25, registered: 22, errors: 2, review: 1 });
    const errors = (
      up.body.rows as { rowNumber: number; status: string; errors: Record<string, string> }[]
    ).filter((r) => r.status === "ERROR");
    expect(errors.flatMap((r) => Object.values(r.errors)).sort()).toEqual(["required", "unknown_model"]);

    const fixes = errors.map((r) => ({
      rowNumber: r.rowNumber,
      values: r.errors.purchaseDate ? { purchaseDate: h.today() } : { modelCode: "SC680" },
    }));
    const fixed = await call("dealer", "PUT", `/bulk-imports/${up.body.id}/rows`, { rows: fixes });
    expect(fixed.body.counts).toEqual({ total: 25, registered: 24, errors: 0, review: 1 });

    const registered = await call("dealer", "GET", "/units?q=263510101");
    expect(registered.body.items[0]).toMatchObject({ batchNumber: "2635-L01", status: "ACTIVE" });
    const inbox = await call("admin", "GET", "/registrations?flag=DUPLICATE&status=PENDING");
    expect(inbox.body.items.some((r: { channel: string }) => r.channel === "BULK")).toBe(true);
  });

  it("DL03: a dealer's registration needs a batch number in the model's format and is approved at once", async () => {
    const bad = await call("dealer", "POST", "/registrations", {
      serial: "SC680-1",
      modelCode: "SC680",
      purchaseDate: h.today(),
      customerName: "X",
    });
    expect(bad.status).toBe(422);
    expect(bad.body.fieldErrors).toEqual({
      serial: "rowErrors.invalid_serial",
      batchNumber: "rowErrors.required",
    });
    expect(
      (
        await call("dealer", "POST", "/registrations", {
          serial: "263899001",
          batchNumber: "L01",
          modelCode: "SC680",
          purchaseDate: h.today(),
          customerName: "X",
        })
      ).body.fieldErrors,
    ).toEqual({
      batchNumber: "rowErrors.invalid_batch",
    });

    const ok = await call("dealer", "POST", "/registrations", {
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
    const unit = await call("dealer", "GET", "/units/263899001");
    expect(unit.body).toMatchObject({
      warrantyStart: "2026-01-10",
      warrantyEnd: "2027-01-09",
      categoryName: "Clamp meters",
    });
  });

  it("W2: a customer's QR registration waits for the warranty desk, then starts the 1-year warranty", async () => {
    const up = await h.upload(s.customer, "/uploads", {
      name: "receipt.jpg",
      mime: "image/jpeg",
      content: JPEG,
    });
    const reg = await call("customer", "POST", "/registrations", {
      serial: "261804517",
      modelCode: "SM482V",
      purchaseDate: h.today(),
      attachmentIds: [up.body.id],
    });
    expect(reg.body).toMatchObject({ status: "PENDING", channel: "PORTAL", flags: [] });
    await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    const unit = await call("customer", "GET", "/units/261804517");
    expect(unit.body).toMatchObject({
      status: "ACTIVE",
      batchNumber: "2618-L02",
      warrantyStart: h.today(),
      daysRemaining: expect.any(Number),
    });
    expect(unit.body.daysRemaining).toBeGreaterThan(360);
  });

  it("public web form: no account, proof of purchase required, waits in the inbox", async () => {
    const fields = {
      serial: "263899002",
      batchNumber: "2638-L02",
      modelCode: "VP87",
      purchaseDate: h.today(),
      customerName: "Jordan Lee",
      customerEmail: "jordan.lee@example.com",
      state: "CA",
      zip: "92612",
    };
    const none = await h.request({ method: "POST", url: "/public/registrations", body: {} });
    expect(none.status).toBe(422);
    const bad = await h.upload(
      null,
      "/public/registrations",
      { name: "r.jpg", mime: "image/jpeg", content: JPEG },
      { ...fields, zip: "926", customerEmail: "nope" },
    );
    expect(bad.body.fieldErrors).toEqual({ zip: "validation.zip", customerEmail: "validation.email" });

    const ok = await h.upload(
      null,
      "/public/registrations",
      { name: "r.jpg", mime: "image/jpeg", content: JPEG },
      fields,
    );
    expect(ok.body).toEqual({ registrationId: expect.stringMatching(/^REG-/), status: "PENDING" });
    const inbox = await call("admin", "GET", `/registrations/${ok.body.registrationId}`);
    expect(inbox.body).toMatchObject({
      channel: "WEB",
      flags: ["EXCEPTION"],
      customer: { name: "Jordan Lee", state: "CA", zip: "92612" },
    });
    expect(inbox.body.attachmentIds).toHaveLength(1);
    await call("admin", "POST", `/registrations/${ok.body.registrationId}/approve`);
    const crm = await call("admin", "GET", "/integrations?system=CRM");
    expect(crm.body.items.some((m: { refId: string }) => m.refId === ok.body.registrationId)).toBe(true);

    const bot = await h.upload(
      null,
      "/public/registrations",
      { name: "r.jpg", mime: "image/jpeg", content: JPEG },
      { ...fields, serial: "263899009", website: "http://spam" },
    );
    expect(bot.status).toBe(200);
    expect((await call("admin", "GET", "/registrations?q=263899009")).body.total).toBe(0);
  });

  it("partner API: clean items registered at once, duplicates reviewed, errors returned per item", async () => {
    const res = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": DEMO_PARTNER_KEYS["pc-desertpeak-pos"] },
      body: {
        registrations: [
          {
            serial: "263899003",
            batchNumber: "2638-L01",
            modelCode: "SC260",
            purchaseDate: h.today(),
            customer: { name: "Pat Moreno", state: "AZ" },
          },
          {
            serial: "251406233",
            batchNumber: "2514-L01",
            modelCode: "SC680",
            purchaseDate: h.today(),
            customer: { name: "Someone" },
          },
          {
            serial: "263899003",
            batchNumber: "2638-L01",
            modelCode: "SC260",
            purchaseDate: h.today(),
            customer: { name: "Repeat" },
          },
          { serial: "x" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "REGISTERED",
      "REVIEW",
      "REVIEW",
      "ERROR",
    ]);
    const unit = await call("admin", "GET", "/units/263899003");
    expect(unit.body).toMatchObject({ dealerId: "d-desertpeak", status: "ACTIVE" });
    const reg = await call("admin", "GET", `/registrations/${res.body.results[0].registrationId}`);
    expect(reg.body.channel).toBe("API");

    const retail = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": DEMO_PARTNER_KEYS["pc-marketplace"] },
      body: {
        serial: "263899006",
        batchNumber: "2638-L02",
        modelCode: "SRS1",
        purchaseDate: h.today(),
        customer: { name: "Nina Patel", email: "nina@example.com" },
      },
    });
    expect(retail.body.results[0].status).toBe("REGISTERED");
    expect((await call("admin", "GET", "/units/263899006")).body).toMatchObject({
      placeOfPurchase: "Online marketplace",
    });

    const denied = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": "fpk_wrong" },
      body: {},
    });
    expect([denied.status, denied.body.code]).toEqual([401, "invalid_api_key"]);
    const created = await call("admin", "POST", "/admin/partner-clients", {
      name: "Retail chain",
      channel: "RETAIL",
    });
    expect(created.status).toBe(201);
    const off = await h.request({
      method: "PATCH",
      url: `/admin/partner-clients/${created.body.client.id}`,
      as: s.admin,
      body: { active: false },
    });
    expect(off.body.active).toBe(false);
    const withOff = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": created.body.apiKey },
      body: {},
    });
    expect(withOff.status).toBe(401);
  });

  it("email intake: reads the registration from the message, keeps the attachment, needs the shared secret", async () => {
    const email = {
      from: "Renee Carter <renee.carter@example.com>",
      subject: "Register my gauge",
      text: "Model: MG44\nSerial number: 263899004\nBatch: 2638-L03\nPurchased: 09/20/2026\nState: LA",
      attachments: [
        { filename: "receipt.jpg", contentType: "image/jpeg", contentBase64: JPEG.toString("base64") },
      ],
    };
    expect(
      (
        await h.request({
          method: "POST",
          url: "/inbound/email",
          headers: { "x-inbound-secret": "wrong" },
          body: email,
        })
      ).status,
    ).toBe(401);
    const res = await h.request({
      method: "POST",
      url: "/inbound/email",
      headers: { "x-inbound-secret": "e2e-inbound-secret-0123456789" },
      body: email,
    });
    expect(res.status).toBe(202);
    const reg = await call("admin", "GET", `/registrations/${res.body.registrationId}`);
    expect(reg.body).toMatchObject({
      channel: "EMAIL",
      serial: "263899004",
      batchNumber: "2638-L03",
      modelCode: "MG44",
      purchaseDate: "2026-09-20",
      customer: { name: "Renee Carter", email: "renee.carter@example.com", state: "LA" },
    });
    expect(reg.body.attachmentIds).toHaveLength(1);
    // Renee is an existing customer (same email): approval links the product to her record.
    await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    expect((await call("admin", "GET", "/units/263899004")).body.customerId).toBe("c-rcarter");

    const unreadable = await h.request({
      method: "POST",
      url: "/inbound/email",
      headers: { "x-inbound-secret": "e2e-inbound-secret-0123456789" },
      body: { from: "x@example.com", text: "hello" },
    });
    expect(unreadable.body.status).toBe("IGNORED");
    const failed = await call("admin", "GET", "/integrations?system=EMAIL&status=FAILED");
    expect(failed.body.total).toBe(1);
  });

  // ── Warranty claims ───────────────────────────────────────────────────────

  it("claims: a covered claim approved as a replacement moves the rest of the warranty to the new serial", async () => {
    const coverage = await call("customer", "GET", "/units/251406233/coverage");
    expect(coverage.body).toMatchObject({ covered: true, reason: "IN_WARRANTY" });
    const filed = await call("customer", "POST", "/claims", {
      unitSerial: "251406233",
      issueType: "DISPLAY",
      description: "Backlight flickers and the reading freezes.",
    });
    expect(filed.body).toMatchObject({
      status: "SUBMITTED",
      source: "CUSTOMER",
      coverage: { covered: true },
      batchNumber: "2514-L01",
      modelCode: "SC680",
    });
    const again = await call("customer", "POST", "/claims", {
      unitSerial: "251406233",
      issueType: "DISPLAY",
      description: "Filing the same problem twice.",
    });
    expect([again.status, again.body.code]).toEqual([409, "claim_open"]);

    const id = filed.body.id as string;
    expect((await move(id, { action: "approve", resolution: "REPAIR" })).body.code).toBe(
      "invalid_transition",
    );
    await move(id, { action: "start_review" });
    expect((await move(id, { action: "approve" })).body.fieldErrors).toEqual({
      resolution: "validation.resolution",
    });
    await move(id, { action: "approve", resolution: "REPLACE", note: "Display fault confirmed." });
    expect((await move(id, { action: "close" })).body.fieldErrors).toEqual({
      replacementSerial: "validation.required",
    });
    expect((await move(id, { action: "close", replacementSerial: "252811902" })).body.code).toBe(
      "duplicate_serial",
    );
    const closed = await move(id, {
      action: "close",
      replacementSerial: "263899005",
      replacementBatchNumber: "2638-L02",
    });
    expect(closed.body).toMatchObject({
      status: "CLOSED",
      resolution: "REPLACE",
      replacementSerial: "263899005",
    });
    expect(closed.body.history.map((e: { status: string }) => e.status)).toEqual([
      "SUBMITTED",
      "IN_REVIEW",
      "APPROVED",
      "CLOSED",
    ]);

    const original = await call("customer", "GET", "/units/251406233");
    const replacement = await call("customer", "GET", "/units/263899005");
    expect(original.body).toMatchObject({ status: "EXPIRED", replacedBySerial: "263899005" });
    expect(replacement.body).toMatchObject({
      status: "ACTIVE",
      replacesSerial: "251406233",
      warrantyEnd: original.body.warrantyEnd,
      warrantyStart: h.today(),
    });
    const notes = await call("customer", "GET", "/notifications");
    expect(notes.body.map((n: { key: string }) => n.key)).toEqual(
      expect.arrayContaining(["claim_approved", "claim_closed"]),
    );
  });

  it("claims: a credit is posted to Finance; a rejection needs a reason; dealers and customers can't decide", async () => {
    const filed = await call("dealer", "POST", "/claims", {
      unitSerial: "252811902",
      issueType: "CONNECTIVITY",
      description: "Gauge drops the Bluetooth link every few minutes.",
    });
    expect(filed.body.source).toBe("DEALER");
    const id = filed.body.id as string;
    expect(
      (await call("dealer", "POST", `/claims/${id}/transitions`, { action: "start_review" })).status,
    ).toBe(403);
    await move(id, { action: "start_review" });
    expect((await move(id, { action: "approve", resolution: "CREDIT" })).body.fieldErrors).toEqual({
      creditAmount: "validation.amount",
    });
    expect(
      (await move(id, { action: "approve", resolution: "CREDIT", creditAmount: 249.5 })).body.creditAmount,
    ).toBe(249.5);
    await move(id, { action: "close" });
    const finance = await call("admin", "GET", "/integrations?system=FINANCE");
    expect(finance.body.items.find((m: { refId: string }) => m.refId === id)).toMatchObject({
      type: "credit_memo",
      payload: { amount: 249.5, currency: "USD" },
    });

    const expired = await call("customer", "POST", "/claims", {
      unitSerial: "243208841",
      issueType: "MECHANICAL",
      description: "Pump motor stalls after a minute.",
    });
    expect(expired.body.coverage).toMatchObject({ covered: false, reason: "EXPIRED" });
    expect((await move(expired.body.id, { action: "reject" })).body.fieldErrors).toEqual({
      reason: "validation.reasonRequired",
    });
    const rejected = await move(expired.body.id, {
      action: "reject",
      reason: "Out of warranty. Repair quote sent.",
    });
    expect(rejected.body).toMatchObject({
      status: "REJECTED",
      rejectReason: "Out of warranty. Repair quote sent.",
    });
    expect((await call("customer", "GET", `/claims/${expired.body.id}`)).body.status).toBe("REJECTED");
  });

  it("moves a claim once when two admins act at the same time", async () => {
    const admin2 = await h.login("admin");
    const claimId = "CLM-1006"; // seeded, In review
    expect((await call("admin", "GET", `/claims/${claimId}`)).body.status).toBe("IN_REVIEW");
    const [a, b] = await Promise.all([
      h.request({
        method: "POST",
        url: `/claims/${claimId}/transitions`,
        as: s.admin,
        body: { action: "approve", resolution: "REPAIR" },
      }),
      h.request({
        method: "POST",
        url: `/claims/${claimId}/transitions`,
        as: admin2,
        body: { action: "reject", reason: "No" },
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await call("admin", "GET", `/claims/${claimId}`)).body.history).toHaveLength(3);
  });

  it("W5: a voided product's claim is filed as not covered", async () => {
    const voided = await call("admin", "POST", "/units/252207119/void", {
      reason: "UNAUTHORIZED_REPAIR",
      note: "Tamper label broken.",
    });
    expect(voided.body.status).toBe("VOID");
    expect(
      (await call("admin", "POST", "/units/252207119/void", { reason: "NOPE" })).body.fieldErrors,
    ).toEqual({ reason: "validation.voidReason" });
    const claim = await call("customer", "POST", "/claims", {
      unitSerial: "252207119",
      issueType: "INACCURATE_READING",
      description: "Detector alarms with no leak present.",
    });
    expect(claim.body.coverage).toMatchObject({ covered: false, reason: "VOID" });
    expect(claim.body.warrantyStatus).toBe("VOID");
  });

  // ── System events, dashboards, reset ──────────────────────────────────────

  it("W6: ERP, email and marketplace intake land where they should; approving the email updates CRM", async () => {
    const erp = await call("admin", "POST", "/simulate/erp-invoice");
    expect(
      erp.body.map(
        (r: { channel: string; status: string; flags: string[] }) =>
          `${r.channel}:${r.status}:${r.flags.length}`,
      ),
    ).toEqual(["ERP:PENDING:0", "ERP:PENDING:0", "ERP:PENDING:0"]);
    const mail = await call("admin", "POST", "/simulate/registration-email");
    expect(mail.body).toMatchObject({ channel: "EMAIL", status: "PENDING", modelCode: "SC680" });
    expect(mail.body.attachmentIds).toHaveLength(1);
    const market = await call("admin", "POST", "/simulate/marketplace-order");
    expect(market.body.map((r: { channel: string; status: string }) => `${r.channel}:${r.status}`)).toEqual([
      "RETAIL:APPROVED",
      "RETAIL:APPROVED",
    ]);

    const bulk = await call("admin", "POST", "/registrations/bulk-approve", {
      ids: [...erp.body.map((r: { id: string }) => r.id), "REG-9999"],
    });
    expect(bulk.body).toEqual({ approved: 3, skipped: 1 });
    await call("admin", "POST", `/registrations/${mail.body.id}/approve`);
    const crm = await call("admin", "GET", "/integrations?system=CRM&direction=OUT");
    expect(crm.body.items.some((m: { refId: string }) => m.refId === mail.body.id)).toBe(true);
  });

  it("W7: the distributor's dashboard covers both dealers and narrows to one", async () => {
    const all = await call("distributor", "GET", "/dashboard/summary");
    expect(all.body.dealers.map((d: { dealerId: string }) => d.dealerId)).toEqual(["d-lonestar", "d-bayou"]);
    expect(all.body.openClaims).toBe(1);
    const bayou = await call("distributor", "GET", "/dashboard/summary?dealerId=d-bayou");
    expect(bayou.body.openClaims).toBe(0);
    const foreign = await call("distributor", "GET", "/dashboard/summary?dealerId=d-desertpeak");
    expect(foreign.body).toMatchObject({ registrationsThisMonth: 0, openClaims: 0 });
  });

  it("dashboard cards add up to the product list, and the list's status matches every product's own", async () => {
    try {
      for (const days of [0, 30, 200, 900]) {
        h.clock.set(new Date(Date.now() + days * 86_400_000));
        s.admin = await h.login("admin"); // sessions expire; moving the clock ahead needs a fresh one
        const dash = await call("admin", "GET", "/dashboard/summary");
        const list = await call("admin", "GET", "/units?pageSize=100");
        const d = dash.body;
        expect(d.units).toBe(list.body.total);
        expect(d.active + d.expiring30 + d.expired + d.pending + d.voided).toBe(d.units);
        for (const status of ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "PENDING"]) {
          const filtered = await call("admin", "GET", `/units?pageSize=100&status=${status}`);
          const expected = (list.body.items as { serial: string; status: string }[])
            .filter((u) => u.status === status)
            .map((u) => u.serial);
          expect([days, status, filtered.body.items.map((u: { serial: string }) => u.serial).sort()]).toEqual(
            [days, status, expected.sort()],
          );
        }
      }
    } finally {
      h.clock.set(new Date());
    }
  });

  it("expires sessions after the idle timeout", async () => {
    try {
      h.clock.set(new Date(Date.now() + 15 * 86_400_000));
      expect(
        (await h.request({ method: "POST", url: "/auth/refresh", headers: { cookie: s.dealer.cookie } }))
          .status,
      ).toBe(401);
      expect((await call("dealer", "GET", "/units")).status).toBe(401);
    } finally {
      h.clock.set(new Date());
    }
  });

  it("resets the data and keeps signed-in users signed in", async () => {
    await call("admin", "POST", "/simulate/erp-invoice");
    expect((await call("admin", "POST", "/simulate/reset")).body).toEqual({ ok: true });
    expect((await call("admin", "GET", "/registrations?channel=ERP&status=PENDING")).body.total).toBe(0);
    expect((await call("dealer", "GET", "/units?pageSize=1")).status).toBe(200);
  });
});
