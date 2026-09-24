import type { Paginated, UnitView } from "@wms/domain";
import {
  createSessionStore,
  dispatch,
  type DemoDb,
  type DemoRequest,
} from "./api";
import { createSeed, DEMO_PASSWORD } from "./seed";
import { addAttachment, getAttachment, ServiceError } from "./services";
import type { DemoState } from "./state";

const TODAY = "2026-09-24";

function setup() {
  const db: DemoDb = { state: createSeed(TODAY), today: () => TODAY };
  const sessions = createSessionStore();
  const call = (req: Partial<DemoRequest> & { path: string }) =>
    dispatch(db, sessions, { method: "GET", query: {}, ...req });
  const login = (email: string) => {
    const res = call({
      method: "POST",
      path: "/auth/login",
      body: { email, password: DEMO_PASSWORD },
    });
    expect(res.status).toBe(200);
    return (res.body as { accessToken: string }).accessToken;
  };
  const units = (token: string, query: DemoRequest["query"] = {}) =>
    call({
      path: "/units",
      accessToken: token,
      query: { pageSize: "100", ...query },
    }).body as Paginated<UnitView>;
  return { db, sessions, call, login, units };
}

describe("seed", () => {
  const state: DemoState = createSeed(TODAY);
  const unit = (serial: string) =>
    state.units.find((u) => u.serial === serial)!;

  it("has the named units from the workflows doc", () => {
    expect(unit("AER-SPL15-240917").parts).toEqual([]);
    expect(unit("AER-SPL15-240917").customerId).toBeUndefined();
    expect(
      unit("AER-SPL15-210311").parts.find((p) => p.partType === "COMPRESSOR")
        ?.warrantyEnd,
    ).toBe("2031-03-11");
    expect(
      unit("AER-SPL18-230502").history.some((e) =>
        /unauthorised repair/i.test(e.text ?? ""),
      ),
    ).toBe(true);
  });

  it("has the model template unit 1y / compressor 10y / PCB 5y", () => {
    const model = state.models.find((m) => m.code === "AER-SPL15")!;
    expect(model.parts.map((p) => [p.partType, p.warrantyMonths])).toEqual([
      ["UNIT", 12],
      ["COMPRESSOR", 120],
      ["PCB", 60],
    ]);
  });

  it("links NorthStar to CoolAir Traders and Breeze Point", () => {
    expect(
      state.dealers
        .filter((d) => d.distributorId === "dist-northstar")
        .map((d) => d.name),
    ).toEqual(["CoolAir Traders", "Breeze Point"]);
  });

  it("has every demo login", () => {
    expect(state.users.map((u) => u.email)).toEqual(
      expect.arrayContaining([
        "admin@demo.wms",
        "dealer.coolair@demo.wms",
        "dist.northstar@demo.wms",
        "customer.rk@demo.wms",
      ]),
    );
  });

  it("only raises claims for claimable complaints", () => {
    for (const claim of state.claims) {
      const complaint = state.complaints.find(
        (c) => c.id === claim.complaintId,
      )!;
      expect(complaint.entitlement.claimable).toBe(true);
    }
  });
});

describe("demo API auth", () => {
  it("offers the demo accounts to the sign-in page without a token", () => {
    const { call } = setup();
    const res = call({ path: "/auth/demo-accounts" });
    expect(res.status).toBe(200);
    const accounts = res.body as {
      email: string;
      label: string;
      password: string;
    }[];
    expect(accounts.map((a) => a.email)).toContain("customer.rk@demo.wms");
    expect(accounts.every((a) => a.password === DEMO_PASSWORD)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const { call } = setup();
    const res = call({
      method: "POST",
      path: "/auth/login",
      body: { email: "admin@demo.wms", password: "x" },
    });
    expect(res.status).toBe(401);
  });

  it("requires a token and restores the session from the refresh cookie", () => {
    const { call } = setup();
    expect(call({ path: "/units" }).status).toBe(401);
    const login = call({
      method: "POST",
      path: "/auth/login",
      body: { email: "admin@demo.wms", password: DEMO_PASSWORD },
    });
    const refresh = call({
      method: "POST",
      path: "/auth/refresh",
      refreshToken: login.setRefreshToken,
    });
    expect(refresh.status).toBe(200);
    expect((refresh.body as { user: { role: string } }).user.role).toBe(
      "admin",
    );
    const out = call({
      method: "POST",
      path: "/auth/logout",
      refreshToken: login.setRefreshToken,
    });
    expect(out.clearRefreshToken).toBe(true);
    expect(
      call({
        method: "POST",
        path: "/auth/refresh",
        refreshToken: login.setRefreshToken,
      }).status,
    ).toBe(401);
  });
});

describe("demo API scoping", () => {
  it("scopes units per role", () => {
    const { login, units } = setup();
    expect(units(login("admin@demo.wms")).total).toBe(15);
    expect(units(login("dist.northstar@demo.wms")).total).toBe(11);
    const coolair = units(login("dealer.coolair@demo.wms"));
    expect(coolair.total).toBe(7);
    expect(coolair.items.every((u) => u.dealerName === "CoolAir Traders")).toBe(
      true,
    );
    const customer = units(login("customer.rk@demo.wms"));
    expect(customer.items.map((u) => u.serial).sort()).toEqual([
      "AER-SPL15-210311",
      "AER-SPL18-230502",
    ]);
  });

  it("hides other dealers' records behind 404", () => {
    const { call, login } = setup();
    const token = login("dealer.coolair@demo.wms");
    expect(
      call({ path: "/units/KEL-CAS30-240220", accessToken: token }).status,
    ).toBe(404);
    expect(
      call({ path: "/units/AER-SPL15-210311", accessToken: token }).status,
    ).toBe(200);
  });

  it("lets the distributor filter by dealer", () => {
    const { login, units } = setup();
    const res = units(login("dist.northstar@demo.wms"), {
      dealerId: "d-breeze",
    });
    expect(res.total).toBe(4);
  });

  it("computes part-wise status in unit views", () => {
    const { call, login } = setup();
    const res = call({
      path: "/units/AER-SPL15-210311",
      accessToken: login("customer.rk@demo.wms"),
    });
    const unit = res.body as UnitView;
    expect(unit.status).toBe("EXPIRED");
    expect(unit.parts.map((p) => [p.partType, p.status])).toEqual([
      ["UNIT", "EXPIRED"],
      ["COMPRESSOR", "ACTIVE"],
      ["PCB", "EXPIRED"],
    ]);
  });

  it("keeps claims, integrations and admin data away from customers and dealers", () => {
    const { call, login } = setup();
    const customer = login("customer.rk@demo.wms");
    const dealer = login("dealer.coolair@demo.wms");
    expect(call({ path: "/claims", accessToken: customer }).status).toBe(403);
    expect(call({ path: "/integrations", accessToken: dealer }).status).toBe(
      403,
    );
    expect(call({ path: "/admin/org", accessToken: dealer }).status).toBe(403);
    expect(
      call({ method: "POST", path: "/simulate/reset", accessToken: dealer })
        .status,
    ).toBe(403);
    const claims = call({
      path: "/claims",
      accessToken: dealer,
      query: { pageSize: "100" },
    }).body as Paginated<{
      dealerId: string;
    }>;
    expect(claims.items.every((c) => c.dealerId === "d-coolair")).toBe(true);
  });

  it("returns role-specific dashboards", () => {
    const { call, login } = setup();
    const admin = call({
      path: "/dashboard/summary",
      accessToken: login("admin@demo.wms"),
    }).body as {
      role: string;
      units: number;
      registrationsByChannel: { channel: string; count: number }[];
    };
    expect(admin.role).toBe("admin");
    expect(admin.units).toBe(15);
    expect(admin.registrationsByChannel.map((c) => c.channel)).toEqual([
      "DEALER",
      "PORTAL",
      "EMAIL",
      "ERP",
    ]);
    const dist = call({
      path: "/dashboard/summary",
      accessToken: login("dist.northstar@demo.wms"),
    }).body as {
      dealers: { dealerName: string }[];
    };
    expect(dist.dealers.map((d) => d.dealerName)).toEqual([
      "CoolAir Traders",
      "Breeze Point",
    ]);
    const dealer = call({
      path: "/dashboard/summary",
      accessToken: login("dealer.coolair@demo.wms"),
    }).body as {
      dealers: unknown[];
    };
    expect(dealer.dealers).toHaveLength(1);
  });

  it("makes the dashboard total match the units list, and the status cards add up to it", () => {
    const { call, login, units } = setup();
    const token = login("admin@demo.wms");
    const summary = call({ path: "/dashboard/summary", accessToken: token })
      .body as Record<string, number>;
    const list = units(token);
    expect(summary.units).toBe(list.total);
    expect(
      summary.active! +
        summary.expiring30! +
        summary.expired! +
        summary.pending! +
        summary.voided!,
    ).toBe(list.total);
    expect(summary.pending).toBe(1); // AER-SPL15-240917: sold with a QR label, not registered yet
  });

  it("resets demo data for the admin", () => {
    const { db, call, login } = setup();
    db.state.units = [];
    const res = call({
      method: "POST",
      path: "/simulate/reset",
      accessToken: login("admin@demo.wms"),
    });
    expect(res.status).toBe(200);
    expect(db.state.units).toHaveLength(15);
  });
});

describe("attachments", () => {
  it("lets only the uploader, admins and people who can see the linked record open a file", () => {
    const state = createSeed(TODAY);
    const ctxFor = (userId: string) => ({
      state,
      user: state.users.find((u) => u.id === userId)!,
      today: TODAY,
      now: `${TODAY}T10:00:00Z`,
    });
    const rk = ctxFor("u-rk");
    const file = addAttachment(
      rk,
      { name: "invoice.jpg", mime: "image/jpeg", size: 1000 },
      (id) => `/api/files/${id}`,
    );
    expect(getAttachment(rk, file.id).name).toBe("invoice.jpg");
    expect(getAttachment(ctxFor("u-admin"), file.id).id).toBe(file.id);
    expect(() => getAttachment(ctxFor("u-breeze"), file.id)).toThrow(
      ServiceError,
    );

    state.units
      .find((u) => u.serial === "AER-SPL15-210311")!
      .attachmentIds.push(file.id);
    expect(getAttachment(ctxFor("u-coolair"), file.id).id).toBe(file.id);
    expect(() => getAttachment(ctxFor("u-breeze"), file.id)).toThrow(
      ServiceError,
    );
  });

  it("refuses unsupported and oversized files", () => {
    const state = createSeed(TODAY);
    const ctx = { state, user: state.users[0]!, today: TODAY, now: TODAY };
    expect(() =>
      addAttachment(
        ctx,
        { name: "a.exe", mime: "application/x-msdownload", size: 10 },
        String,
      ),
    ).toThrow(/photo, video or PDF/);
    expect(() =>
      addAttachment(
        ctx,
        { name: "big.jpg", mime: "image/jpeg", size: 20 * 1024 * 1024 },
        String,
      ),
    ).toThrow(/15 MB/);
  });
});
