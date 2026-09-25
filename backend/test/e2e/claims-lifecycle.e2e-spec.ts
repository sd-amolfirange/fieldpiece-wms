import { randomUUID } from "node:crypto";
import { buildWorld, makeClaim, makeRegistration, type World } from "../fixtures/factories";
import { createHarness, type Harness } from "../setup/harness";

// The claim state machine end to end (Sections 8.3, 6.5 and 13.3).

let h: Harness;
let world: World;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  h = await createHarness();
  world = await buildWorld(h.db);
  for (const [key, u] of Object.entries(world.users)) tokens[key] = await h.tokenFor(u.email);
});
afterAll(() => h.close());

const etag = (headers: Record<string, unknown>) => String(headers.etag);

describe("claim lifecycle", () => {
  it("goes from draft to closed through an RMA", async () => {
    const reg = await makeRegistration(h.db, world, {
      createdBy: world.users.distA.id,
      distributorId: world.orgs.distA,
    });

    // Distributor files a draft for their customer's unit, by serial.
    const draft = await h.request({
      method: "POST",
      url: "/claims",
      token: tokens.distA,
      body: {
        serialNumber: reg.serialNumber.toLowerCase(),
        failureCategory: "no_power",
        failureDate: reg.purchaseDate.toISOString().slice(0, 10),
        description: "Dead on arrival at the job site. New batteries did not help.",
        preferredResolution: "repair",
      },
    });
    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({
      status: "DRAFT",
      displayNo: "CLM-000001",
      allowedActions: ["submit"],
    });
    const id = String(draft.body.id);

    const submitted = await h.request({
      method: "POST",
      url: `/claims/${id}/submit`,
      token: tokens.distA,
      headers: { "if-match": etag(draft.headers) },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("SUBMITTED");
    expect(submitted.body.slaDueAt).toEqual(expect.any(String));

    // The customer can't review their own claim.
    const forbidden = await h.request({
      method: "POST",
      url: `/claims/${id}/start-review`,
      token: tokens.distA,
      headers: { "if-match": etag(submitted.headers) },
    });
    expect(forbidden.status).toBe(403);

    const review = await h.request({
      method: "POST",
      url: `/claims/${id}/start-review`,
      token: tokens.agent,
      headers: { "if-match": etag(submitted.headers) },
    });
    expect(review.body).toMatchObject({ status: "IN_REVIEW", assignee: { id: world.users.agent.id } });
    expect(review.body.allowedActions).toEqual(["requestInfo", "approve", "reject"]);

    const needsInfo = await h.request({
      method: "POST",
      url: `/claims/${id}/request-info`,
      token: tokens.agent,
      headers: { "if-match": etag(review.headers) },
      body: { message: "Send a photo of the label." },
    });
    expect(needsInfo.body.status).toBe("NEEDS_INFO");

    const responded = await h.request({
      method: "POST",
      url: `/claims/${id}/respond`,
      token: tokens.distA,
      headers: { "if-match": etag(needsInfo.headers) },
      body: { message: "Photo attached." },
    });
    expect(responded.body.status).toBe("IN_REVIEW");

    const approved = await h.request({
      method: "POST",
      url: `/claims/${id}/approve`,
      token: tokens.agent,
      headers: { "if-match": etag(responded.headers) },
      body: { resolution: "replace" },
    });
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      status: "RMA_ISSUED",
      resolution: "replace",
      rma: { displayNo: "RMA-000001", status: "ISSUED", type: "replace" },
    });

    const rmaId = String((approved.body.rma as { id: string }).id);
    let rma = await h.request({ method: "GET", url: `/rmas/${rmaId}`, token: tokens.svc });
    expect(rma.body.allowedActions).toEqual(["shipInbound", "receive"]);

    rma = await h.request({
      method: "POST",
      url: `/rmas/${rmaId}/ship-inbound`,
      token: tokens.distA,
      headers: { "if-match": etag(rma.headers) },
      body: { trackingNumber: "1Z999AA10123456784" },
    });
    expect(rma.body).toMatchObject({ status: "IN_TRANSIT", inboundCarrier: "UPS" });
    rma = await h.request({
      method: "POST",
      url: `/rmas/${rmaId}/receive`,
      token: tokens.svc,
      headers: { "if-match": etag(rma.headers) },
      body: {},
    });
    rma = await h.request({
      method: "POST",
      url: `/rmas/${rmaId}/inspect`,
      token: tokens.svc,
      headers: { "if-match": etag(rma.headers) },
      body: { findings: "Cracked main board.", rootCause: "component_failure" },
    });
    expect(rma.body.status).toBe("INSPECTED");

    const missing = await h.request({
      method: "POST",
      url: `/rmas/${rmaId}/complete`,
      token: tokens.svc,
      headers: { "if-match": etag(rma.headers) },
      body: {},
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe("REPLACEMENT_SERIAL_REQUIRED");

    rma = await h.request({
      method: "POST",
      url: `/rmas/${rmaId}/complete`,
      token: tokens.svc,
      headers: { "if-match": etag(rma.headers) },
      body: { replacementSerial: "SC680-REPL001" },
    });
    expect(rma.body.status).toBe("COMPLETED");

    // Replacement: the old unit is void and the new serial carries the remaining term.
    const old = await h.db.registration.findUniqueOrThrow({ where: { id: reg.id } });
    const replacement = await h.db.registration.findFirstOrThrow({
      where: { serialNumber: "SC680-REPL001" },
    });
    expect(old.status).toBe("VOID");
    expect(replacement).toMatchObject({ replacesRegistrationId: reg.id, warrantyEnd: old.warrantyEnd });

    const claim = await h.request({ method: "GET", url: `/claims/${id}`, token: tokens.agent });
    expect(claim.body).toMatchObject({ status: "REPLACED", allowedActions: ["close"] });
    const closed = await h.request({
      method: "POST",
      url: `/claims/${id}/close`,
      token: tokens.agent,
      headers: { "if-match": etag(claim.headers) },
      body: {},
    });
    expect(closed.body.status).toBe("CLOSED");

    // Every step left an event, an audit row and outbox events.
    const events = await h.request({ method: "GET", url: `/claims/${id}/events`, token: tokens.agent });
    const statuses = (events.body.items as { toStatus: string | null }[])
      .map((e) => e.toStatus)
      .filter(Boolean);
    expect(statuses).toEqual([
      "DRAFT",
      "SUBMITTED",
      "IN_REVIEW",
      "NEEDS_INFO",
      "IN_REVIEW",
      "APPROVED",
      "RMA_ISSUED",
      "IN_TRANSIT",
      "RECEIVED",
      "REPLACED",
      "CLOSED",
    ]);
    expect(await h.db.auditLog.count({ where: { entityId: id, action: "claim.status_changed" } })).toBe(10);
    expect(await h.db.outboxEvent.count({ where: { aggregateId: id, type: "claim.approved" } })).toBe(1);
  });

  it("rejects with a reason, then only allows closing", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, {
      registrationId: reg.id,
      createdBy: world.users.tech.id,
      status: "IN_REVIEW",
    });
    const noReason = await h.request({
      method: "POST",
      url: `/claims/${claim.id}/reject`,
      token: tokens.agent,
      headers: { "if-match": 'W/"1"' },
      body: { message: "Water damage visible inside." },
    });
    expect(noReason.status).toBe(400);
    const rejected = await h.request({
      method: "POST",
      url: `/claims/${claim.id}/reject`,
      token: tokens.agent,
      headers: { "if-match": 'W/"1"' },
      body: { reason: "physical_damage", message: "Water damage visible inside." },
    });
    expect(rejected.body).toMatchObject({
      status: "REJECTED",
      rejectionReason: "physical_damage",
      allowedActions: ["close"],
    });
    const approveAfter = await h.request({
      method: "POST",
      url: `/claims/${claim.id}/approve`,
      token: tokens.agent,
      headers: { "if-match": etag(rejected.headers) },
      body: { resolution: "repair" },
    });
    expect(approveAfter.status).toBe(409);
    expect(approveAfter.body.code).toBe("CLAIM_INVALID_TRANSITION");
  });

  it("requires a photo for display failures", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await h.db.claim.create({
      data: {
        registrationId: reg.id,
        failureCategory: "display",
        description: "Screen shows random segments after a few minutes of use.",
        failureDate: reg.purchaseDate,
        inWarranty: true,
        createdBy: world.users.tech.id,
      },
    });
    const res = await h.request({
      method: "POST",
      url: `/claims/${claim.id}/submit`,
      token: tokens.tech,
      headers: { "if-match": 'W/"1"' },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PHOTO_REQUIRED");
  });
});

describe("concurrency and idempotency (Section 13.3)", () => {
  it("lets only one of two agents approve the same claim", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, {
      registrationId: reg.id,
      createdBy: world.users.tech.id,
      status: "IN_REVIEW",
    });
    const approve = (token: string | undefined) =>
      h.request({
        method: "POST",
        url: `/claims/${claim.id}/approve`,
        token,
        headers: { "if-match": 'W/"1"' },
        body: { resolution: "repair" },
      });
    const results = await Promise.all([approve(tokens.agent), approve(tokens.agent2)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("STALE_VERSION");
    expect(await h.db.rma.count({ where: { claimId: claim.id } })).toBe(1);
  });

  it("replays a submit with the same Idempotency-Key without a second event", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, { registrationId: reg.id, createdBy: world.users.tech.id });
    const key = randomUUID();
    const submit = () =>
      h.request({
        method: "POST",
        url: `/claims/${claim.id}/submit`,
        token: tokens.tech,
        headers: { "if-match": 'W/"1"', "idempotency-key": key },
      });
    const first = await submit();
    const second = await submit();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(await h.db.claimEvent.count({ where: { claimId: claim.id, toStatus: "SUBMITTED" } })).toBe(1);
  });

  it("requires If-Match on transitions", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, { registrationId: reg.id, createdBy: world.users.tech.id });
    const res = await h.request({ method: "POST", url: `/claims/${claim.id}/submit`, token: tokens.tech });
    expect(res.status).toBe(428);
  });
});
