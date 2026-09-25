import { SignJWT, generateKeyPair } from "jose";
import { buildWorld, makeClaim, makeRegistration, type World } from "../fixtures/factories";
import { createHarness, type Harness } from "../setup/harness";

// Authentication, the permission matrix (Section 7.3) and object-level scope (Section 11.3).

let h: Harness;
let world: World;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  h = await createHarness();
  world = await buildWorld(h.db);
  for (const [key, u] of Object.entries(world.users)) tokens[key] = await h.tokenFor(u.email);
});
afterAll(() => h.close());

describe("authentication", () => {
  it("rejects requests without a token", async () => {
    const res = await h.request({ method: "GET", url: "/claims" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
    expect(res.body.requestId).toEqual(expect.any(String));
  });

  it("rejects a token signed by someone else's key", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: world.users.admin.email })
      .setProtectedHeader({ alg: "RS256", kid: "evil" })
      .setSubject("dev|admin")
      .setIssuer("http://localhost:3000/dev-idp")
      .setAudience("fieldpiece-wms-api")
      .setExpirationTime("5m")
      .sign(privateKey);
    expect((await h.request({ method: "GET", url: "/me", token: forged })).status).toBe(401);
  });

  it("rejects HS256 and alg=none tokens", async () => {
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("dev|admin")
      .sign(new TextEncoder().encode("secret"));
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "dev|admin" })).toString("base64url")}.`;
    expect((await h.request({ method: "GET", url: "/me", token: hs })).status).toBe(401);
    expect((await h.request({ method: "GET", url: "/me", token: none })).status).toBe(401);
  });

  it("returns the profile with roles from the database", async () => {
    const res = await h.request({ method: "GET", url: "/me", token: tokens.distA });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: world.users.distA.email,
      roles: ["distributor"],
      primaryRole: "distributor",
    });
    expect(res.body.permissions).toContain("registrations:bulk");
  });

  it("keeps the public warranty check open, with minimal data", async () => {
    await makeRegistration(h.db, world, { createdBy: world.users.tech.id, serial: "SC680-PUBLIC1" });
    const res = await h.request({ method: "GET", url: "/warranty/check?serial=sc680-public1" });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([
      "product",
      "registered",
      "serialNumber",
      "warrantyEnd",
      "warrantyStatus",
    ]);
  });

  it("sends the X-Request-Id header on every response", async () => {
    const res = await h.request({
      method: "GET",
      url: "/health/live",
      headers: { "x-request-id": "trace-12345678" },
    });
    expect(res.headers["x-request-id"]).toBe("trace-12345678");
  });
});

describe("role guard (layer 1)", () => {
  it.each([
    ["tech", "GET", "/reports/claims-summary", 403],
    ["svc", "GET", "/customers", 403],
    ["agent", "GET", "/users", 403],
    ["admin", "GET", "/users", 200],
    ["distA", "GET", "/reports/claims-summary", 200],
    ["agent", "GET", "/reports/claim-rate-by-sku", 200],
    ["distA", "GET", "/reports/claim-rate-by-sku", 403],
  ] as const)("%s %s %s -> %i", async (who, method, url, status) => {
    expect((await h.request({ method, url, token: tokens[who] })).status).toBe(status);
  });

  it("only lets admins manage products", async () => {
    const body = { sku: "NEW1", name: "New", family: "meters" };
    expect((await h.request({ method: "POST", url: "/products", token: tokens.agent, body })).status).toBe(
      403,
    );
    expect((await h.request({ method: "POST", url: "/products", token: tokens.admin, body })).status).toBe(
      201,
    );
  });
});

describe("data scope (layer 2)", () => {
  it("hides another distributor's registrations and customers behind 404", async () => {
    const regB = await makeRegistration(h.db, world, {
      createdBy: world.users.distB.id,
      distributorId: world.orgs.distB,
    });
    expect(
      (await h.request({ method: "GET", url: `/registrations/${regB.id}`, token: tokens.distA })).status,
    ).toBe(404);
    expect(
      (await h.request({ method: "GET", url: `/customers/${regB.customerId}`, token: tokens.distA })).status,
    ).toBe(404);
    expect(
      (await h.request({ method: "GET", url: `/registrations/${regB.id}`, token: tokens.distB })).status,
    ).toBe(200);

    const list = await h.request({ method: "GET", url: "/registrations", token: tokens.distA });
    expect((list.body.items as { id: string }[]).map((r) => r.id)).not.toContain(regB.id);
  });

  it("stops a technician reading another technician's claim", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech2.id });
    const claim = await makeClaim(h.db, {
      registrationId: reg.id,
      createdBy: world.users.tech2.id,
      status: "SUBMITTED",
    });
    expect((await h.request({ method: "GET", url: `/claims/${claim.id}`, token: tokens.tech })).status).toBe(
      404,
    );
    expect(
      (await h.request({ method: "GET", url: `/claims/${claim.id}/events`, token: tokens.tech })).status,
    ).toBe(404);
    expect((await h.request({ method: "GET", url: `/claims/${claim.id}`, token: tokens.tech2 })).status).toBe(
      200,
    );
  });

  it("never shows internal notes to customers", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, {
      registrationId: reg.id,
      createdBy: world.users.tech.id,
      status: "IN_REVIEW",
    });
    const note = { comment: "Batch looks affected by the connector issue.", internal: true };
    expect(
      (
        await h.request({
          method: "POST",
          url: `/claims/${claim.id}/comments`,
          token: tokens.agent,
          body: note,
        })
      ).status,
    ).toBe(201);
    await h.request({
      method: "POST",
      url: `/claims/${claim.id}/comments`,
      token: tokens.agent,
      body: { comment: "Thanks, reviewing." },
    });

    const asTech = await h.request({ method: "GET", url: `/claims/${claim.id}/events`, token: tokens.tech });
    const asAgent = await h.request({
      method: "GET",
      url: `/claims/${claim.id}/events`,
      token: tokens.agent,
    });
    expect((asTech.body.items as { internal: boolean }[]).some((e) => e.internal)).toBe(false);
    expect((asAgent.body.items as { internal: boolean }[]).some((e) => e.internal)).toBe(true);
  });

  it("forbids customers from writing internal notes", async () => {
    const reg = await makeRegistration(h.db, world, { createdBy: world.users.tech.id });
    const claim = await makeClaim(h.db, {
      registrationId: reg.id,
      createdBy: world.users.tech.id,
      status: "SUBMITTED",
    });
    const res = await h.request({
      method: "POST",
      url: `/claims/${claim.id}/comments`,
      token: tokens.tech,
      body: { comment: "Sneaky", internal: true },
    });
    expect(res.status).toBe(403);
  });
});
