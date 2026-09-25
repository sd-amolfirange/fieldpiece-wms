import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHarness, type Harness, JPEG, type Session, type Who } from "../setup/harness";

// The demo workflows (frontend/docs/demo-workflows.md) through the API, plus what a mock server can't show:
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

  it("W1: bulk import registers clean rows, sends the duplicate to review, and re-checks fixed rows in place", async () => {
    const file = readFileSync(join(__dirname, "../../../demo-assets/coolair_sales_week38.xlsx"));
    const up = await h.upload(s.dealer, "/bulk-imports", {
      name: "coolair_sales_week38.xlsx",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      content: file,
    });
    expect(up.status).toBe(201);
    expect(up.body.counts).toEqual({ total: 25, registered: 22, errors: 2, review: 1 });
    const errors = (up.body.rows as { rowNumber: number; status: string; errors: Record<string, string>; values: Record<string, string> }[]).filter(
      (r) => r.status === "ERROR",
    );
    expect(errors.flatMap((r) => Object.values(r.errors)).sort()).toEqual(["required", "unknown_model"]);

    const fixes = errors.map((r) => ({
      rowNumber: r.rowNumber,
      values: r.errors.installDate ? { installDate: h.today() } : { modelCode: "AER-SPL15" },
    }));
    const fixed = await call("dealer", "PUT", `/bulk-imports/${up.body.id}/rows`, { rows: fixes });
    expect(fixed.status).toBe(200);
    expect(fixed.body.counts).toEqual({ total: 25, registered: 24, errors: 0, review: 1 });

    const inbox = await call("admin", "GET", "/registrations?flag=EXCEPTION&status=PENDING");
    expect(inbox.body.items.some((r: { channel: string; flags: string[] }) => r.channel === "BULK" && r.flags.includes("DUPLICATE"))).toBe(true);
    const history = await call("dealer", "GET", "/bulk-imports");
    expect(history.body[0].id).toBe(up.body.id);
    const notes = await call("dealer", "GET", "/notifications");
    expect(notes.body[0].key).toBe("bulk_processed");
  });

  it("refuses sheets that aren't xlsx or csv, and empty ones", async () => {
    const bad = await h.upload(s.dealer, "/bulk-imports", { name: "sales.pdf", mime: "application/pdf", content: Buffer.from("%PDF-1.4") });
    expect([bad.status, bad.body.code]).toEqual([415, "unsupported_type"]);
    const empty = await h.upload(s.dealer, "/bulk-imports", { name: "e.csv", mime: "text/csv", content: Buffer.from("Serial number,Model code\r\n") });
    expect([empty.status, empty.body.code]).toEqual([422, "empty_file"]);
  });

  it("W2: a customer's QR registration waits for the admin, then attaches every part's warranty", async () => {
    const up = await h.upload(s.customer, "/uploads", { name: "invoice.jpg", mime: "image/jpeg", content: JPEG });
    const reg = await call("customer", "POST", "/registrations", {
      serial: "aer-spl15-240917",
      modelCode: "AER-SPL15",
      purchaseDate: h.today(),
      attachmentIds: [up.body.id],
    });
    expect(reg.status).toBe(200);
    expect(reg.body).toMatchObject({ status: "PENDING", channel: "PORTAL", flags: [], serial: "AER-SPL15-240917" });

    const approved = await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    expect(approved.body.status).toBe("APPROVED");
    const unit = await call("customer", "GET", "/units/AER-SPL15-240917");
    expect(unit.body.status).toBe("ACTIVE");
    expect(unit.body.parts.map((p: { partType: string; warrantyStart: string }) => [p.partType, p.warrantyStart])).toEqual([
      ["UNIT", h.today()],
      ["COMPRESSOR", h.today()],
      ["PCB", h.today()],
    ]);
    // The invoice now belongs to a record the customer can see; the admin saw it next to the data.
    expect((await call("admin", "GET", (up.body.url as string).replace(/^\/api/, ""))).status).toBe(200);

    const again = await call("admin", "POST", `/registrations/${reg.body.id}/approve`);
    expect([again.status, again.body.code]).toEqual([409, "not_pending"]);
  });

  it("validates customer registrations with field errors the form understands", async () => {
    const res = await call("customer", "POST", "/registrations", { serial: "", modelCode: "", purchaseDate: "2999-01-01" });
    expect(res.status).toBe(422);
    expect(res.body.fieldErrors).toEqual({
      serial: "validation.required",
      modelCode: "validation.required",
      purchaseDate: "rowErrors.future_date",
      attachmentIds: "validation.invoiceRequired",
    });
  });

  it("DL03: a dealer's clean registration is approved at once; a duplicate serial goes to review", async () => {
    const clean = await call("dealer", "POST", "/registrations", {
      serial: "AER-SPL18-269901",
      modelCode: "AER-SPL18",
      installDate: h.today(),
      customerName: "A. Joshi",
      customerPhone: "9000000102", // matches the existing customer by phone
    });
    expect(clean.body).toMatchObject({ status: "APPROVED", channel: "DEALER", dealerId: "d-coolair", customerId: "c-aj" });

    const dup = await call("dealer", "POST", "/registrations", {
      serial: "AER-SPL15-210311",
      modelCode: "AER-SPL15",
      installDate: h.today(),
      customerName: "Someone",
    });
    expect(dup.body).toMatchObject({ status: "PENDING", flags: ["DUPLICATE", "EXCEPTION"], duplicateOfSerial: "AER-SPL15-210311" });
    expect(dup.body.duplicateOf).toBeUndefined(); // only admins get the comparison
    const review = await call("admin", "GET", `/registrations/${dup.body.id}`);
    expect(review.body.duplicateOf.serial).toBe("AER-SPL15-210311");
    expect((await call("admin", "POST", `/registrations/${dup.body.id}/approve`)).body.code).toBe("duplicate_serial");
    const rejected = await call("admin", "POST", `/registrations/${dup.body.id}/reject`, { reason: "Already registered" });
    expect(rejected.body).toMatchObject({ status: "REJECTED", rejectReason: "Already registered" });

    const invalid = await call("dealer", "POST", "/registrations", { serial: "x", modelCode: "NOPE", installDate: "2999-01-01" });
    expect(invalid.status).toBe(422);
    expect(invalid.body.fieldErrors).toEqual({
      serial: "rowErrors.invalid_serial",
      modelCode: "rowErrors.unknown_model",
      installDate: "rowErrors.future_date",
      customerName: "rowErrors.required",
    });
    const noDealer = await call("distributor", "POST", "/registrations", { serial: "AER-SPL18-269902", modelCode: "AER-SPL18", installDate: h.today(), customerName: "X" });
    expect(noDealer.body.fieldErrors).toEqual({ dealerId: "validation.pickDealer" });
  });

  it("W3: complaint -> service -> job result -> draft claim -> OEM -> paid, all in the integration log", async () => {
    const preview = await call("customer", "GET", "/units/AER-SPL15-210311/entitlement");
    expect(preview.body).toEqual({ parts: "COVERED", labour: "CHARGEABLE", coveredPartTypes: ["COMPRESSOR"], claimable: true, reason: "PARTIAL" });
    const complaint = await call("customer", "POST", "/complaints", { unitSerial: "AER-SPL15-210311", description: "no cooling", attachmentIds: [] });
    expect(complaint.body).toMatchObject({ source: "CUSTOMER", status: "NEW", entitlement: preview.body });

    const sent = await call("admin", "POST", `/complaints/${complaint.body.id}/send-to-service`);
    expect(sent.body.status).toBe("WITH_SERVICE");
    expect((await call("admin", "POST", `/complaints/${complaint.body.id}/send-to-service`)).body.code).toBe("already_sent");

    const job = await call("admin", "POST", "/simulate/job-result", { complaintId: complaint.body.id });
    expect(job.body.status).toBe("RESOLVED");
    const replaced = job.body.jobResult.partsReplaced[0];
    expect(replaced).toMatchObject({ partType: "COMPRESSOR", oldSerial: "CP-210311" });
    expect(job.body.jobResult.photos).toHaveLength(2);

    const unit = await call("admin", "GET", "/units/AER-SPL15-210311");
    const fitted = unit.body.parts.find((p: { serial: string }) => p.serial === replaced.newSerial);
    expect(fitted).toMatchObject({ warrantyStart: h.today(), replacesSerial: "CP-210311", status: "ACTIVE" });
    expect(unit.body.history.map((e: { type: string }) => e.type).slice(-3)).toEqual(["complaint_raised", "part_replaced", "claim_created"]);

    const claimId = job.body.claimId as string;
    const draft = await call("admin", "GET", `/claims/${claimId}`);
    expect(draft.body).toMatchObject({ status: "DRAFT", brandName: "Aeris", complaintDescription: "no cooling", financePosting: "NOT_POSTED" });
    expect((await call("admin", "POST", `/claims/${claimId}/transitions`, { action: "submit" })).body.fieldErrors).toEqual({ amount: "validation.amount" });
    expect((await call("admin", "POST", `/claims/${claimId}/transitions`, { action: "mark_paid" })).body.code).toBe("invalid_transition");
    expect((await call("admin", "POST", `/claims/${claimId}/transitions`, { action: "submit", amount: 5400.4, rmaNumber: "AER-RMA-1" })).body).toMatchObject({
      status: "SUBMITTED",
      amount: 5400,
      rmaNumber: "AER-RMA-1",
    });
    expect((await call("admin", "POST", "/simulate/oem-decision", { claimId, decision: "APPROVED" })).body.status).toBe("APPROVED");
    const paid = await call("admin", "POST", `/claims/${claimId}/transitions`, { action: "mark_paid" });
    expect(paid.body).toMatchObject({ status: "PAID", financePosting: "POSTED" });
    expect(paid.body.history.map((e: { status: string }) => e.status)).toEqual(["DRAFT", "SUBMITTED", "APPROVED", "PAID"]);

    const log = await call("admin", "GET", "/integrations?pageSize=100");
    const types = (log.body.items as { type: string; refId: string }[]).filter((m) => m.refId === claimId || m.refId === complaint.body.id).map((m) => m.type);
    expect(types.sort()).toEqual(["claim_submission", "finance_posting", "job_result", "oem_decision", "service_request"]);

    const tracking = await call("customer", "GET", `/complaints/${complaint.body.id}`);
    expect(tracking.body.history.map((e: { status: string }) => e.status)).toEqual(["NEW", "WITH_SERVICE", "RESOLVED"]);
    expect(tracking.body.claimStatus).toBeUndefined(); // customers never see claims
    expect((await call("dealer", "GET", `/complaints/${complaint.body.id}`)).body.claimStatus).toBe("PAID");
  });

  it("moves a claim once when two admins act at the same time", async () => {
    const admin2 = await h.login("admin");
    const claimId = "CLM-1002"; // seeded SUBMITTED claim (Kelvin)
    expect((await call("admin", "GET", `/claims/${claimId}`)).body.status).toBe("SUBMITTED");
    const [a, b] = await Promise.all([
      h.request({ method: "POST", url: `/claims/${claimId}/transitions`, as: s.admin, body: { action: "approve" } }),
      h.request({ method: "POST", url: `/claims/${claimId}/transitions`, as: admin2, body: { action: "reject", reason: "No" } }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const events = (await call("admin", "GET", `/claims/${claimId}`)).body.history as unknown[];
    expect(events).toHaveLength(3); // DRAFT, SUBMITTED, and exactly one decision
  });

  it("W5: a voided unit's complaint is chargeable and creates no claim", async () => {
    const voided = await call("admin", "POST", "/units/AER-SPL18-230502/void", { reason: "UNAUTHORISED_REPAIR", note: "Seal broken" });
    expect(voided.body.status).toBe("VOID");
    expect(voided.body.parts.every((p: { status: string }) => p.status === "VOID")).toBe(true);
    expect((await call("admin", "POST", "/units/AER-SPL18-230502/void", { reason: "NOPE" })).body.fieldErrors).toEqual({ reason: "validation.voidReason" });

    const complaint = await call("customer", "POST", "/complaints", { unitSerial: "AER-SPL18-230502", description: "Makes a noise" });
    expect(complaint.body.entitlement).toMatchObject({ parts: "CHARGEABLE", labour: "CHARGEABLE", claimable: false, reason: "VOID" });
    await call("admin", "POST", `/complaints/${complaint.body.id}/send-to-service`);
    const job = await call("admin", "POST", "/simulate/job-result", { complaintId: complaint.body.id });
    expect(job.body.status).toBe("RESOLVED");
    expect(job.body.claimId).toBeUndefined();
  });

  it("W6: ERP and email intake land in the inbox; approving the email updates CRM", async () => {
    const erp = await call("admin", "POST", "/simulate/erp-invoice");
    expect(erp.body.map((r: { channel: string; status: string }) => `${r.channel}:${r.status}`)).toEqual(["ERP:PENDING", "ERP:PENDING", "ERP:PENDING"]);
    expect(new Set(erp.body.map((r: { serial: string }) => r.serial)).size).toBe(3);
    const mail = await call("admin", "POST", "/simulate/registration-email");
    expect(mail.body).toMatchObject({ channel: "EMAIL", status: "PENDING" });
    expect(mail.body.attachmentIds).toHaveLength(1);

    const bulk = await call("admin", "POST", "/registrations/bulk-approve", { ids: [...erp.body.map((r: { id: string }) => r.id), "REG-9999"] });
    expect(bulk.body).toEqual({ approved: 3, skipped: 1 });
    await call("admin", "POST", `/registrations/${mail.body.id}/approve`);
    const crm = await call("admin", "GET", "/integrations?system=CRM&direction=OUT");
    expect(crm.body.items.some((m: { refId: string; type: string }) => m.refId === mail.body.id && m.type === "crm_update")).toBe(true);

    const failed = (await call("admin", "GET", "/integrations?status=FAILED")).body.items[0];
    const retried = await call("admin", "POST", `/integrations/${failed.id}/retry`);
    expect(retried.body).toMatchObject({ status: "SUCCESS", attempts: 2 });
    expect((await call("admin", "POST", `/integrations/${failed.id}/retry`)).body.code).toBe("not_failed");
  });

  it("W7: the distributor's dashboard covers both dealers and narrows to one", async () => {
    const all = await call("distributor", "GET", "/dashboard/summary");
    expect(all.body.dealers.map((d: { dealerId: string }) => d.dealerId)).toEqual(["d-coolair", "d-breeze"]);
    const breeze = await call("distributor", "GET", "/dashboard/summary?dealerId=d-breeze");
    expect(breeze.body.openComplaints).toBe(1);
    const foreign = await call("distributor", "GET", "/dashboard/summary?dealerId=d-arctic");
    expect(foreign.body).toMatchObject({ registrationsThisMonth: 0, openComplaints: 0, claimsInProgress: 0 });
  });

  it("admin dashboard cards add up to the Units list, and the list's status matches every unit's own", async () => {
    try {
      await checkStatusesOverTime();
    } finally {
      h.clock.set(new Date());
    }
  });

  async function checkStatusesOverTime() {
    for (const days of [0, 30, 400, 3000]) {
      h.clock.set(new Date(Date.now() + days * 86_400_000));
      s.admin = await h.login("admin"); // sessions expire; moving the clock years ahead needs a fresh one
      const dash = await call("admin", "GET", "/dashboard/summary");
      const list = await call("admin", "GET", "/units?pageSize=100");
      const d = dash.body;
      expect(d.units).toBe(list.body.total);
      expect(d.active + d.expiring30 + d.expired + d.pending + d.voided).toBe(d.units);
      for (const status of ["ACTIVE", "EXPIRING_SOON", "EXPIRED", "VOID", "PENDING"]) {
        const filtered = await call("admin", "GET", `/units?pageSize=100&status=${status}`);
        const expected = (list.body.items as { serial: string; status: string }[]).filter((u) => u.status === status).map((u) => u.serial);
        expect([days, status, filtered.body.items.map((u: { serial: string }) => u.serial).sort()]).toEqual([days, status, expected.sort()]);
      }
    }
  }

  it("expires sessions after the idle timeout", async () => {
    try {
      h.clock.set(new Date(Date.now() + 15 * 86_400_000));
      expect((await h.request({ method: "POST", url: "/auth/refresh", headers: { cookie: s.dealer.cookie } })).status).toBe(401);
      expect((await call("dealer", "GET", "/units")).status).toBe(401);
    } finally {
      h.clock.set(new Date());
    }
  });

  it("resets the demo data and keeps signed-in users signed in", async () => {
    await call("admin", "POST", "/simulate/erp-invoice");
    const reset = await call("admin", "POST", "/simulate/reset");
    expect(reset.body).toEqual({ ok: true });
    expect((await call("admin", "GET", "/registrations?channel=ERP&status=PENDING")).body.total).toBe(0);
    expect((await call("dealer", "GET", "/units?pageSize=1")).status).toBe(200);
  });
});
