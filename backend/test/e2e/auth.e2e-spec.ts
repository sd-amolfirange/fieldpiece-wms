import { createHarness, DEMO_PASSWORD, type Harness } from "../setup/harness";

describe("auth and sessions", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(() => h.close());

  it("signs in with email and password, returns the session user and sets an httpOnly refresh cookie", async () => {
    const res = await h.request({ method: "POST", url: "/auth/login", body: { email: " Dealer.CoolAir@demo.wms ", password: DEMO_PASSWORD } });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user).toEqual({
      id: "u-coolair",
      name: "CoolAir Traders",
      email: "dealer.coolair@demo.wms",
      role: "dealer",
      dealerId: "d-coolair",
      orgName: "CoolAir Traders",
      currency: "INR",
    });
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/^wms_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/api/);
  });

  it("answers invalid_credentials for a wrong password or an unknown email", async () => {
    for (const body of [
      { email: "admin@demo.wms", password: "wrong" },
      { email: "nobody@demo.wms", password: DEMO_PASSWORD },
      {},
    ]) {
      const res = await h.request({ method: "POST", url: "/auth/login", body });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: "invalid_credentials" });
      expect(typeof res.body.requestId).toBe("string");
    }
  });

  it("refreshes with the cookie alone and rejects without it", async () => {
    const s = await h.login("admin");
    const ok = await h.request({ method: "POST", url: "/auth/refresh", headers: { cookie: s.cookie } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe("admin");
    const fresh = { token: ok.body.accessToken as string, cookie: s.cookie };
    expect((await h.request({ method: "GET", url: "/units", as: fresh })).status).toBe(200);

    const none = await h.request({ method: "POST", url: "/auth/refresh" });
    expect(none.status).toBe(401);
    expect(none.body.code).toBe("unauthenticated");
  });

  it("ends both tokens on logout", async () => {
    const s = await h.login("customer");
    const out = await h.request({ method: "POST", url: "/auth/logout", as: s });
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/wms_refresh=;/);
    expect((await h.request({ method: "GET", url: "/units", as: s })).status).toBe(401);
    expect((await h.request({ method: "POST", url: "/auth/refresh", headers: { cookie: s.cookie } })).status).toBe(401);
  });

  it("accepts the session cookie only on file routes, never on JSON endpoints", async () => {
    const s = await h.login("customer");
    expect((await h.request({ method: "GET", url: "/units", as: s, cookieOnly: true })).status).toBe(401);
    const pdf = await h.request({ method: "GET", url: "/units/AER-SPL15-210311/certificate.pdf", as: s, cookieOnly: true });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.raw.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejects tampered and foreign tokens", async () => {
    const s = await h.login("admin");
    const [header, payload] = s.token.split(".");
    const forged = `${header}.${payload}.invalidsignature`;
    const res = await h.request({ method: "GET", url: "/units", headers: { authorization: `Bearer ${forged}` } });
    expect(res.status).toBe(401);
  });

  it("offers the demo accounts only while demo features are on", async () => {
    const res = await h.request({ method: "GET", url: "/auth/demo-accounts" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
    expect(res.body[0]).toEqual({ email: "admin@demo.wms", label: "Admin: WMS office admin", password: DEMO_PASSWORD });

    const off = await createHarness({ env: { DEMO_FEATURES_ENABLED: "false" } });
    try {
      expect((await off.request({ method: "GET", url: "/auth/demo-accounts" })).status).toBe(404);
      const admin = await off.login("admin");
      expect((await off.request({ method: "POST", url: "/simulate/reset", as: admin })).status).toBe(404);
    } finally {
      await off.close();
    }
  });
});
