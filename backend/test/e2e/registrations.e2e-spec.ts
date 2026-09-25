import { buildWorld, makeRegistration, type World } from "../fixtures/factories";
import { createHarness, type Harness } from "../setup/harness";

// Registration rules (Section 8.2) and the duplicate race (Section 13.3).

let h: Harness;
let world: World;
const tokens: Record<string, string> = {};
const owner = {
  contactName: "Jordan Lee",
  address: { line1: "12 Main St", city: "Fresno", region: "CA", postalCode: "93650", country: "us" },
};

beforeAll(async () => {
  h = await createHarness();
  world = await buildWorld(h.db);
  for (const [key, u] of Object.entries(world.users)) tokens[key] = await h.tokenFor(u.email);
});
afterAll(() => h.close());

describe("registrations", () => {
  it("registers a technician's own unit and computes the warranty from the policy", async () => {
    const res = await h.request({
      method: "POST",
      url: "/registrations",
      token: tokens.tech,
      body: { serialNumber: " sc680-000001 ", sku: "sc680", purchaseDate: "2026-01-31", customer: owner },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      serialNumber: "SC680-000001",
      sku: "SC680",
      warrantyStart: "2026-01-31",
      warrantyEnd: "2028-01-30", // 24 months, ending the day before the anniversary
      policyId: world.policyId,
    });
    const customer = await h.db.customer.findFirstOrThrow({ where: { userId: world.users.tech.id } });
    expect(customer.address).toMatchObject({ country: "US" });
    expect(
      await h.db.outboxEvent.count({
        where: { type: "registration.created", aggregateId: String(res.body.id) },
      }),
    ).toBe(1);
  });

  it.each([
    [{ purchaseDate: "2999-01-01" }, 422, "PURCHASE_IN_FUTURE"],
    [{ purchaseDate: "2018-12-31" }, 422, "PURCHASE_BEFORE_LAUNCH"],
    [{ sku: "NOPE" }, 422, "PRODUCT_NOT_FOUND"],
    [{ purchaseDate: "31/01/2026" }, 400, "VALIDATION_FAILED"],
  ])("rejects %o with %i %s", async (patch, status, code) => {
    const res = await h.request({
      method: "POST",
      url: "/registrations",
      token: tokens.tech,
      body: {
        serialNumber: "SC680-RULES1",
        sku: "SC680",
        purchaseDate: "2026-01-01",
        customer: owner,
        ...patch,
      },
    });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(res.body.fieldErrors).toBeDefined();
  });

  it("tells the caller whether they own a duplicate, without leaking someone else's", async () => {
    await makeRegistration(h.db, world, {
      createdBy: world.users.distB.id,
      distributorId: world.orgs.distB,
      serial: "SC680-DUP001",
    });
    const res = await h.request({
      method: "POST",
      url: "/registrations",
      token: tokens.distA,
      body: { serialNumber: "SC680-DUP001", sku: "SC680", purchaseDate: "2026-01-01", customer: owner },
    });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: "REGISTRATION_DUPLICATE_SERIAL", details: { ownedByYou: false } });
    expect(JSON.stringify(res.body)).not.toContain("registrationId");
  });

  it("lets exactly one of two parallel registrations for the same unit win", async () => {
    const body = { serialNumber: "SC680-RACE01", sku: "SC680", purchaseDate: "2026-01-01", customer: owner };
    const results = await Promise.all([
      h.request({ method: "POST", url: "/registrations", token: tokens.distA, body }),
      h.request({ method: "POST", url: "/registrations", token: tokens.distB, body }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await h.db.registration.count({ where: { serialNumber: "SC680-RACE01", status: "ACTIVE" } })).toBe(
      1,
    );
  });

  it("requires proof of purchase when configured", async () => {
    const strict = await createHarnessWithProof();
    try {
      const token = await strict.tokenFor(world.users.tech.email);
      const res = await strict.request({
        method: "POST",
        url: "/registrations",
        token,
        body: { serialNumber: "SC680-PROOF1", sku: "SC680", purchaseDate: "2026-01-01", customer: owner },
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("PROOF_OF_PURCHASE_REQUIRED");
    } finally {
      await strict.app.close();
    }
  });

  it("lets only admins void, with If-Match", async () => {
    const reg = await makeRegistration(h.db, world, {
      createdBy: world.users.tech.id,
      serial: "SC680-VOID01",
    });
    const body = { reason: "Registered in error by the customer." };
    expect(
      (
        await h.request({
          method: "POST",
          url: `/registrations/${reg.id}/void`,
          token: tokens.agent,
          headers: { "if-match": 'W/"1"' },
          body,
        })
      ).status,
    ).toBe(403);
    const voided = await h.request({
      method: "POST",
      url: `/registrations/${reg.id}/void`,
      token: tokens.admin,
      headers: { "if-match": 'W/"1"' },
      body,
    });
    expect(voided.body).toMatchObject({ status: "VOID", version: 2 });
    const check = await h.request({ method: "GET", url: "/warranty/check?serial=SC680-VOID01" });
    expect(check.body.registered).toBe(false);
  });
});

/** Same database, different config; skips the truncate so this suite's fixtures stay. */
async function createHarnessWithProof() {
  const { createApp } = await import("../../src/app.factory");
  const { testEnv } = await import("../setup/test-env");
  const app = await createApp(testEnv({ REQUIRE_PROOF_OF_PURCHASE: "true" }), { logs: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const request = async (opts: { method: "POST"; url: string; token?: string; body?: unknown }) => {
    const res = await app.inject({
      method: opts.method,
      url: opts.url.startsWith("/dev-idp") ? opts.url : `/api/v1${opts.url}`,
      headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
      payload: opts.body as Record<string, unknown>,
    });
    return { status: res.statusCode, body: JSON.parse(res.body) as Record<string, unknown> };
  };
  return {
    app,
    request,
    tokenFor: async (email: string) =>
      String((await request({ method: "POST", url: "/dev-idp/token", body: { email } })).body.accessToken),
  };
}
