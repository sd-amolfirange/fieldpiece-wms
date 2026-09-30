import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addDaysIso, addMonthsIso } from "@wms/domain";
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
  /** Every page of the product list (at most 100 a page). */
  const allUnits = async (who: Who, query = "") => {
    const items: { serial: string; status: string; registrationChannel?: string }[] = [];
    for (let page = 1; ; page += 1) {
      const res = await call(who, "GET", `/units?pageSize=100&page=${page}${query}`);
      items.push(...res.body.items);
      if (items.length >= res.body.total || !res.body.items.length)
        return { total: res.body.total as number, items };
    }
  };

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
    const unit = await call("dealer", "GET", "/units/SC680-263899001");
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
      serial: "SM482V-261804517",
      modelCode: "SM482V",
      purchaseDate: h.today(),
      attachmentIds: [up.body.id],
    });
    expect(reg.body).toMatchObject({ status: "PENDING", channel: "PORTAL", flags: [] });
    await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    const unit = await call("customer", "GET", "/units/SM482V-261804517");
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
            serial: "SC680-251406233",
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
    const unit = await call("admin", "GET", "/units/SC260-263899003");
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
    expect((await call("admin", "GET", "/units/SRS1-263899006")).body).toMatchObject({
      placeOfPurchase: "Online marketplace",
      registrationChannel: "RETAIL",
    });

    // Fieldpiece's apps use the same API with their own keys; the registration gets the app's channel.
    const app = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": DEMO_PARTNER_KEYS["pc-joblink"] },
      body: {
        serial: "263899021",
        batchNumber: "2638-L02",
        modelCode: "JL3PR",
        purchaseDate: h.today(),
        customer: { name: "Dana Whitaker", email: "dana.whitaker@example.com", state: "TX", zip: "77002" },
      },
    });
    expect(app.body.results[0].status).toBe("REGISTERED");
    expect(
      (await call("admin", "GET", `/registrations/${app.body.results[0].registrationId}`)).body,
    ).toMatchObject({
      channel: "JOBLINK",
      status: "APPROVED",
      submittedByName: "Fieldpiece Job Link",
    });
    const appUnit = (await call("admin", "GET", "/units/JL3PR-263899021")).body;
    expect(appUnit).toMatchObject({ status: "ACTIVE", registrationChannel: "JOBLINK" });
    expect(appUnit.dealerId).toBeUndefined();
    const again = await h.request({
      method: "POST",
      url: "/partner/v1/registrations",
      headers: { "x-api-key": DEMO_PARTNER_KEYS["pc-overwatch"] },
      body: {
        serial: "JL3PR-263899021",
        batchNumber: "2638-L02",
        modelCode: "JL3PR",
        purchaseDate: h.today(),
        customer: { name: "Someone Else" },
      },
    });
    expect(again.body.results[0].status).toBe("REVIEW");
    expect(
      (await call("admin", "GET", `/registrations/${again.body.results[0].registrationId}`)).body,
    ).toMatchObject({
      channel: "OVERWATCH",
      status: "PENDING",
      flags: ["DUPLICATE", "EXCEPTION"],
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
    const app2 = await call("admin", "POST", "/admin/partner-clients", {
      name: "Job Link (test)",
      channel: "JOBLINK",
    });
    expect([app2.status, app2.body.client.channel]).toEqual([201, "JOBLINK"]);
    const clients = (await call("admin", "GET", "/admin/partner-clients")).body as {
      id: string;
      channel: string;
    }[];
    expect(clients.slice(0, 4).map((c) => [c.id, c.channel])).toEqual([
      ["pc-desertpeak-pos", "API"],
      ["pc-marketplace", "RETAIL"],
      ["pc-overwatch", "OVERWATCH"],
      ["pc-joblink", "JOBLINK"],
    ]);
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
      serial: "MG44-263899004",
      batchNumber: "2638-L03",
      modelCode: "MG44",
      purchaseDate: "2026-09-20",
      customer: { name: "Renee Carter", email: "renee.carter@example.com", state: "LA" },
    });
    expect(reg.body.attachmentIds).toHaveLength(1);
    // Renee is an existing customer (same email): approval links the product to her record.
    await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    expect((await call("admin", "GET", "/units/MG44-263899004")).body.customerId).toBe("c-rcarter");

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
    const coverage = await call("customer", "GET", "/units/SC680-251406233/coverage");
    expect(coverage.body).toMatchObject({ covered: true, reason: "IN_WARRANTY" });
    const filed = await call("customer", "POST", "/claims", {
      unitSerial: "SC680-251406233",
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
      unitSerial: "SC680-251406233",
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
    expect((await move(id, { action: "close", replacementSerial: "SC680-252409963" })).body.code).toBe(
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
      replacementSerial: "SC680-263899005",
    });
    expect(closed.body.history.map((e: { status: string }) => e.status)).toEqual([
      "SUBMITTED",
      "IN_REVIEW",
      "APPROVED",
      "CLOSED",
    ]);

    const original = await call("customer", "GET", "/units/SC680-251406233");
    const replacement = await call("customer", "GET", "/units/SC680-263899005");
    expect(original.body).toMatchObject({ status: "EXPIRED", replacedBySerial: "SC680-263899005" });
    expect(replacement.body).toMatchObject({
      status: "ACTIVE",
      replacesSerial: "SC680-251406233",
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
      unitSerial: "MG44-252811902",
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
      unitSerial: "VP87-243208841",
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
    const voided = await call("admin", "POST", "/units/DR82-252207119/void", {
      reason: "UNAUTHORIZED_REPAIR",
      note: "Tamper label broken.",
    });
    expect(voided.body.status).toBe("VOID");
    expect(
      (await call("admin", "POST", "/units/DR82-252207119/void", { reason: "NOPE" })).body.fieldErrors,
    ).toEqual({ reason: "validation.voidReason" });
    const claim = await call("customer", "POST", "/claims", {
      unitSerial: "DR82-252207119",
      issueType: "INACCURATE_READING",
      description: "Detector alarms with no leak present.",
    });
    expect(claim.body.coverage).toMatchObject({ covered: false, reason: "VOID" });
    expect(claim.body.warrantyStatus).toBe("VOID");
  });

  // ── Extended warranties and finance ───────────────────────────────────────

  it("sells an extended warranty in one step: new end date, event, notification and Finance invoice", async () => {
    const serial = "SC680-251406233";
    const before = (await call("customer", "GET", `/units/${serial}`)).body;
    expect(before.extensions).toEqual([]);
    const quote = await call("customer", "GET", `/units/${serial}/extension`);
    expect(quote.body).toMatchObject({ eligible: true, currentEnd: before.warrantyEnd, extendedMonths: 0 });
    expect(quote.body.options.map((o: { months: number; price: number }) => [o.months, o.price])).toEqual([
      [12, 48.99],
      [24, 85.99],
      [36, 114.99],
    ]);

    const bought = await call("customer", "POST", `/units/${serial}/extensions`, { months: 12 });
    expect(bought.status).toBe(200);
    const newEnd = quote.body.options[0].newEnd as string;
    expect(bought.body).toMatchObject({ warrantyEnd: newEnd, status: "ACTIVE" });
    expect(bought.body.extensions).toEqual([
      expect.objectContaining({
        id: "EXT-1019",
        months: 12,
        price: 48.99,
        previousEnd: before.warrantyEnd,
        newEnd,
        soldBy: "u-mreed",
        dealerId: "d-lonestar",
      }),
    ]);
    expect(bought.body.history.at(-1)).toMatchObject({ type: "extended", refId: "EXT-1019" });
    const notes = await call("dealer", "GET", "/notifications");
    expect(notes.body[0]).toMatchObject({ key: "unit_extended", params: { serial, months: 12, newEnd } });
    const finance = await call("admin", "GET", "/integrations?system=FINANCE&q=EXT-1019");
    expect(finance.body.items[0]).toMatchObject({
      type: "extension_invoice",
      direction: "OUT",
      payload: { extensionId: "EXT-1019", serial, model: "SC680", months: 12, price: 48.99, currency: "USD" },
    });
    const pdf = await h.request({ method: "GET", url: `/units/${serial}/certificate.pdf`, as: s.customer });
    expect(pdf.status).toBe(200);

    // 36 months at most: after 12, only 12 or 24 more.
    expect(
      (await call("customer", "POST", `/units/${serial}/extensions`, { months: 36 })).body.fieldErrors,
    ).toEqual({ months: "validation.extensionPlan" });
    expect((await call("customer", "POST", `/units/${serial}/extensions`, { months: 24 })).status).toBe(200);
    const full = await call("customer", "POST", `/units/${serial}/extensions`, { months: 12 });
    expect([full.status, full.body.code]).toEqual([409, "not_extendable"]);
    expect((await call("customer", "GET", `/units/${serial}/extension`)).body).toMatchObject({
      eligible: false,
      reason: "LIMIT_REACHED",
      extendedMonths: 36,
    });
    // The SQL status (list filter) follows the extended end date.
    const listed = await call("customer", "GET", `/units?q=${serial}`);
    expect(listed.body.items[0]).toMatchObject({ status: "ACTIVE", warrantyEnd: addMonthsIso(newEnd, 24) });
  });

  it("credits the selling dealer and refuses products that can't be extended", async () => {
    const sold = await call("dealer", "POST", "/units/MG44-252811902/extensions", { months: 24 });
    expect(sold.body.extensions[0]).toMatchObject({
      soldBy: "u-lonestar",
      dealerId: "d-lonestar",
      price: 48.99,
    });

    const refused = async (who: Who, serial: string) => {
      const res = await call(who, "POST", `/units/${serial}/extensions`, { months: 12 });
      return [res.status, res.body.code, (await call(who, "GET", `/units/${serial}/extension`)).body.reason];
    };
    expect(await refused("customer", "VP87-243208841")).toEqual([409, "not_extendable", "EXPIRED"]);
    expect(await refused("admin", "SM482V-261804517")).toEqual([409, "not_extendable", "NOT_REGISTERED"]);
    expect(await refused("admin", "SM382V-252005531")).toEqual([409, "not_extendable", "REPLACED"]);
    await call("admin", "POST", "/units/DR82-252207119/void", { reason: "MISUSE" });
    expect(await refused("customer", "DR82-252207119")).toEqual([409, "not_extendable", "VOID"]);
    expect(
      (await call("admin", "POST", "/units/SC680-252409963/extensions", { months: 6 })).body.fieldErrors,
    ).toEqual({ months: "validation.extensionPlan" });
    expect((await call("customer", "POST", "/units/SC680-252409963/extensions", { months: 12 })).status).toBe(
      404,
    );
  });

  it("sells one extension when two requests arrive at the same time", async () => {
    const serial = "SC680-252409963";
    const admin2 = await h.login("admin");
    const [a, b] = await Promise.all([
      h.request({ method: "POST", url: `/units/${serial}/extensions`, as: s.admin, body: { months: 36 } }),
      h.request({ method: "POST", url: `/units/${serial}/extensions`, as: admin2, body: { months: 36 } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await call("admin", "GET", `/units/${serial}`)).body.extensions).toHaveLength(1);
  });

  it("shows a model's internal finance figures to the warranty desk only", async () => {
    const internal = ["repairCost", "warrantyBudget", "claimQuota"];
    const sc680 = (models: { code: string }[]) =>
      models.find((m) => m.code === "SC680") as Record<string, unknown>;
    expect(sc680((await call("admin", "GET", "/models")).body)).toMatchObject({
      listPrice: 329,
      repairCost: 99,
    });
    const views = [
      (await call("dealer", "GET", "/models")).body,
      (await call("customer", "GET", "/models")).body,
      (await h.request({ method: "GET", url: "/public/models" })).body,
    ];
    for (const models of views) {
      const model = sc680(models);
      expect(model.listPrice).toBe(329);
      expect(internal.filter((f) => f in model)).toEqual([]);
    }
  });

  it("reports warranty cost against budget, scoped to the caller's dealers", async () => {
    const admin = (await call("admin", "GET", "/dashboard/finance")).body;
    expect(admin).toMatchObject({
      currency: "USD",
      periodStart: addDaysIso(addMonthsIso(h.today(), -12), 1),
      periodEnd: h.today(),
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
    expect(admin.monthly.at(-1).month).toBe(h.today().slice(0, 7));
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

    expect((await call("dealer", "GET", "/dashboard/finance")).body).toMatchObject({
      warrantyCost: 2622.65,
      extensionRevenue: 631.93,
      extensionsSold: 7,
      budget: 46443,
      creditsIssued: 1010.25,
    });
    expect((await call("distributor", "GET", "/dashboard/finance?dealerId=d-bayou")).body).toMatchObject({
      warrantyCost: 1584.4,
      extensionsSold: 2,
    });
    expect((await call("distributor", "GET", "/dashboard/finance?dealerId=d-desertpeak")).body).toMatchObject(
      {
        warrantyCost: 0,
        budget: 0,
        quotas: [],
      },
    );
  });

  it("lets the warranty desk set a model's price and quota", async () => {
    const patch = (who: Who, id: string, body: unknown) =>
      h.request({ method: "PATCH", url: `/models/${id}`, as: s[who], body });
    expect((await patch("admin", "m-sc680", { listPrice: 349.5, claimQuota: 5 })).body).toMatchObject({
      code: "SC680",
      listPrice: 349.5,
      repairCost: 99,
      warrantyBudget: 823,
      claimQuota: 5,
      categoryName: "Clamp meters",
    });
    const models = (await call("dealer", "GET", "/models")).body as { id: string; listPrice: number }[];
    expect(models.find((m) => m.id === "m-sc680")?.listPrice).toBe(349.5);
    const bad = await patch("admin", "m-sc680", { repairCost: -1, warrantyBudget: 1.234, claimQuota: 2.5 });
    expect([bad.status, bad.body.fieldErrors]).toEqual([
      422,
      {
        repairCost: "validation.amount",
        warrantyBudget: "validation.amount",
        claimQuota: "validation.quota",
      },
    ]);
    expect((await patch("admin", "m-sc680", { listPrice: 1_000_000.01 })).body.fieldErrors).toEqual({
      listPrice: "validation.amount",
    });
    expect((await patch("admin", "m-nope", { listPrice: 1 })).status).toBe(404);
  });

  it("adds status counts and 12-month trends to the dashboards", async () => {
    const admin = (await call("admin", "GET", "/dashboard/summary")).body;
    expect(admin.trend).toHaveLength(12);
    expect(admin.trend.at(-1).month).toBe(h.today().slice(0, 7));
    expect(admin.trend.reduce((n: number, m: { claims: number }) => n + m.claims, 0)).toBe(53);

    const dealer = (await call("dealer", "GET", "/dashboard/summary")).body;
    expect(dealer.unitsByStatus.map((c: { status: string }) => c.status)).toEqual([
      "ACTIVE",
      "EXPIRING_SOON",
      "EXPIRED",
      "VOID",
      "PENDING",
    ]);
    const units = (await call("dealer", "GET", "/units?pageSize=100")).body.total as number;
    expect(dealer.unitsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(units);
    expect(dealer.claimsByStatus).toHaveLength(5);
    expect(dealer.claimsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(18);
    expect(dealer.trend.reduce((n: number, m: { claims: number }) => n + m.claims, 0)).toBe(18);
    const bayou = (await call("distributor", "GET", "/dashboard/summary?dealerId=d-bayou")).body;
    expect(bayou.unitsByStatus.reduce((n: number, c: { count: number }) => n + c.count, 0)).toBe(63);
    expect(bayou.claimsByStatus.find((c: { status: string }) => c.status === "CLOSED").count).toBe(8);
    expect((await call("customer", "GET", "/dashboard/summary")).body.unitsByStatus).toEqual([
      { status: "ACTIVE", count: 6 },
      { status: "EXPIRING_SOON", count: 1 },
      { status: "EXPIRED", count: 1 },
      { status: "VOID", count: 0 },
      { status: "PENDING", count: 0 },
    ]);
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

  it("A13: Job Link and Overwatch register new products through the partner API with their own channels", async () => {
    const joblink = await call("admin", "POST", "/simulate/joblink-registration");
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
    const overwatch = await call("admin", "POST", "/simulate/overwatch-registration");
    expect(
      overwatch.body.map((r: { channel: string; status: string }) => `${r.channel}:${r.status}`),
    ).toEqual(["OVERWATCH:APPROVED"]);
    expect((await call("admin", "GET", `/units/${overwatch.body[0].serial}`)).body).toMatchObject({
      status: "ACTIVE",
      registrationChannel: "OVERWATCH",
    });
    const apps = (await call("admin", "GET", "/dashboard/summary")).body.apps as {
      channel: string;
      units: number;
      last30Days: number;
    }[];
    expect(apps.map((a) => [a.channel, a.units, a.last30Days])).toEqual([
      ["OVERWATCH", 21, 2],
      ["JOBLINK", 32, 8],
    ]);
    expect((await call("customer", "POST", "/simulate/joblink-registration")).status).toBe(403);
    expect((await call("dealer", "POST", "/simulate/overwatch-registration")).status).toBe(403);
  });

  it("reports the products registered from Fieldpiece's apps and filters the list by channel", async () => {
    const summary = (await call("admin", "GET", "/dashboard/summary")).body;
    expect(
      summary.registrationsByChannel.map((c: { channel: string; count: number }) => [c.channel, c.count]),
    ).toEqual([
      ["DEALER", 112],
      ["PORTAL", 22],
      ["WEB", 15],
      ["EMAIL", 9],
      ["ERP", 11],
      ["API", 24],
      ["RETAIL", 7],
      ["OVERWATCH", 20],
      ["JOBLINK", 30],
    ]);
    expect(summary).toMatchObject({
      units: 267,
      pending: 13,
      voided: 6,
      openClaims: 20,
      pendingRegistrations: 15,
    });
    expect(summary.apps).toEqual([
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
    for (const app of summary.apps as { channel: string; units: number }[]) {
      const list = await allUnits("admin", `&channel=${app.channel}`);
      expect([app.channel, list.total]).toEqual([app.channel, app.units]);
      expect(list.items.every((u) => u.registrationChannel === app.channel)).toBe(true);
    }
    expect((await allUnits("admin", "&channel=APPS")).total).toBe(50);
    expect((await allUnits("admin", "&channel=FAX")).total).toBe(267); // not a channel: no filter
    expect((await allUnits("dealer", "&channel=APPS")).total).toBe(0); // the apps register without a dealer
    expect((await allUnits("customer", "&channel=APPS")).items.map((u) => u.serial)).toEqual([
      "SC440-263473208",
    ]);
    expect((await allUnits("customer", "&channel=PORTAL")).items.map((u) => u.serial)).toEqual([
      "DR82-252207119",
      "JL3KR4-252479315",
    ]);
    // The channel of the registration that started the warranty; none before registration or for a replacement.
    expect((await call("admin", "GET", "/units/SC680-251406233")).body.registrationChannel).toBe("DEALER");
    expect((await call("admin", "GET", "/units/SM482V-261804517")).body.registrationChannel).toBeUndefined();
    expect((await call("admin", "GET", "/units/SM382V-252707701")).body.registrationChannel).toBeUndefined();
    expect((await call("dealer", "GET", "/dashboard/summary")).body.apps).toBeUndefined();
  });

  it("gives every dealer registrations this month", async () => {
    const desertpeak = await h.login("desertpeak");
    const bayou = await h.login("bayou");
    for (const [who, as] of [
      ["dealer", s.dealer],
      ["bayou", bayou],
      ["desertpeak", desertpeak],
    ] as const) {
      const d = (await h.request({ method: "GET", url: "/dashboard/summary", as })).body;
      expect([who, d.registrationsThisMonth > 0, d.dealers[0].registrationsThisMonth > 0]).toEqual([
        who,
        true,
        true,
      ]);
    }
    expect(
      (await call("distributor", "GET", "/dashboard/summary")).body.registrationsThisMonth,
    ).toBeGreaterThan(0);
  });

  it("W7: the distributor's dashboard covers both dealers and narrows to one", async () => {
    const all = await call("distributor", "GET", "/dashboard/summary");
    expect(all.body.dealers.map((d: { dealerId: string }) => d.dealerId)).toEqual(["d-lonestar", "d-bayou"]);
    expect(all.body.openClaims).toBe(9);
    const bayou = await call("distributor", "GET", "/dashboard/summary?dealerId=d-bayou");
    expect(bayou.body.openClaims).toBe(5);
    const foreign = await call("distributor", "GET", "/dashboard/summary?dealerId=d-desertpeak");
    expect(foreign.body).toMatchObject({ registrationsThisMonth: 0, openClaims: 0 });
  });

  it("dashboard cards add up to the product list, and the list's status matches every product's own", async () => {
    try {
      for (const days of [0, 30, 200, 900]) {
        h.clock.set(new Date(Date.now() + days * 86_400_000));
        s.admin = await h.login("admin"); // sessions expire; moving the clock ahead needs a fresh one
        const dash = await call("admin", "GET", "/dashboard/summary");
        const list = await allUnits("admin");
        const d = dash.body;
        expect(d.units).toBe(list.total);
        expect(list.items).toHaveLength(list.total);
        expect(d.active + d.expiring30 + d.expired + d.pending + d.voided).toBe(d.units);
        for (const status of ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "PENDING"]) {
          const filtered = await allUnits("admin", `&status=${status}`);
          const expected = list.items.filter((u) => u.status === status).map((u) => u.serial);
          expect([days, status, filtered.items.map((u) => u.serial).sort()]).toEqual([
            days,
            status,
            expected.sort(),
          ]);
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
