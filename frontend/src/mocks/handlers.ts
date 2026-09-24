import { delay, http, HttpResponse } from "msw";
import { env } from "@/lib/env";
import { CLAIM_TRANSITIONS, type ClaimAction } from "@/features/claims/transitions";
import type { ApiErrorBody, Claim, ClaimStatus, Paginated, Role, SessionUser } from "@/types";
import { claims, customers, mockUsers, products, registrations, rmas } from "./data";

// MSW handlers for every endpoint (Section 9), so the frontend can be built before the backend.
// Endpoint shapes here are the frontend's proposal: align them with the backend OpenAPI spec.

const basePath = new URL(env.apiBaseUrl, "http://localhost").pathname.replace(/\/$/, "");
const api = (path: string) => `*${basePath}${path}`;

const error = (status: number, body: ApiErrorBody) => HttpResponse.json(body, { status });

// Simulates the httpOnly refresh cookie across reloads. Mock-only; real tokens never touch storage.
const SESSION_KEY = "wms-mock-session";
function currentMockUser(): SessionUser | null {
  try {
    const role = globalThis.sessionStorage?.getItem(SESSION_KEY) as Role | null;
    return role ? mockUsers[role] : null;
  } catch {
    return null;
  }
}
function setMockUser(role: Role | null) {
  try {
    if (role) globalThis.sessionStorage?.setItem(SESSION_KEY, role);
    else globalThis.sessionStorage?.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

function paginate<T>(items: T[], url: URL): Paginated<T> {
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize")) || 25);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

function sortBy<T>(items: T[], sort: string | null): T[] {
  if (!sort) return items;
  const desc = sort.startsWith("-");
  const key = sort.replace(/^-/, "") as keyof T;
  return [...items].sort((a, b) => {
    const av = String(a[key] ?? "");
    const bv = String(b[key] ?? "");
    return desc ? bv.localeCompare(av) : av.localeCompare(bv);
  });
}

export const handlers = [
  // ---- Auth -------------------------------------------------------------
  http.post(api("/auth/login"), async ({ request }) => {
    await delay(300);
    const body = (await request.json()) as { email?: string; password?: string; role?: Role };
    if (!body.email || !body.password) {
      return error(422, {
        code: "validation_error",
        message: "Check the highlighted fields.",
        fieldErrors: {
          ...(body.email ? {} : { email: "Enter your email." }),
          ...(body.password ? {} : { password: "Enter your password." }),
        },
      });
    }
    const role = body.role ?? "technician";
    setMockUser(role);
    return HttpResponse.json({ accessToken: `mock-token-${role}`, user: mockUsers[role] });
  }),

  http.post(api("/auth/refresh"), async () => {
    await delay(100);
    const user = currentMockUser();
    if (!user) return error(401, { code: "unauthenticated", message: "Session expired. Sign in again." });
    return HttpResponse.json({ accessToken: `mock-token-${user.role}`, user });
  }),

  http.post(api("/auth/logout"), () => {
    setMockUser(null);
    return new HttpResponse(null, { status: 204 });
  }),

  http.post(api("/auth/forgot-password"), async () => {
    await delay(300);
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- Public warranty check -------------------------------------------
  http.get(api("/warranty/check"), async ({ request }) => {
    await delay(300);
    const serial = new URL(request.url).searchParams.get("serial")?.toUpperCase() ?? "";
    if (serial === "RATELIMIT") {
      return error(429, {
        code: "rate_limited",
        message: "Too many checks in a short time. Wait a minute, then try again.",
      });
    }
    const reg = registrations.find((r) => r.serialNumber === serial);
    const skuPrefix = serial.split("-")[0];
    const product = products.find((p) => p.sku === (reg?.sku ?? skuPrefix));
    if (!product) {
      return error(404, {
        code: "serial_not_found",
        message: "Serial number not found. Check the label on the back of the unit, or register it first.",
      });
    }
    return HttpResponse.json({
      serialNumber: serial,
      product,
      registered: !!reg,
      warrantyStatus: reg?.status ?? "NOT_REGISTERED",
      warrantyEnd: reg?.warrantyEnd ?? null,
    });
  }),

  // ---- Products ---------------------------------------------------------
  http.get(api("/products"), () => HttpResponse.json(products)),
  http.get(api("/products/:sku"), ({ params }) => {
    const product = products.find((p) => p.sku === params.sku);
    return product
      ? HttpResponse.json(product)
      : error(404, { code: "not_found", message: "Product not found." });
  }),

  // ---- Registrations ----------------------------------------------------
  http.get(api("/registrations"), async ({ request }) => {
    await delay(250);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.toUpperCase();
    const items = sortBy(
      registrations.filter((r) => !q || r.serialNumber.includes(q) || r.sku.includes(q)),
      url.searchParams.get("sort") ?? "-createdAt",
    );
    return HttpResponse.json(paginate(items, url));
  }),

  http.post(api("/registrations"), async ({ request }) => {
    await delay(400);
    const body = (await request.json()) as { serialNumber: string; sku: string; purchaseDate: string };
    if (registrations.some((r) => r.serialNumber === body.serialNumber)) {
      return error(409, {
        code: "duplicate_serial",
        message: "This unit is already registered.",
        fieldErrors: { serialNumber: "This unit is already registered." },
      });
    }
    const product = products.find((p) => p.sku === body.sku) ?? products[0]!;
    const end = new Date(body.purchaseDate);
    end.setMonth(end.getMonth() + product.warrantyMonths);
    const created = {
      id: `reg-${registrations.length + 1}`,
      serialNumber: body.serialNumber,
      sku: product.sku,
      customerId: "c-1",
      purchaseDate: body.purchaseDate,
      proofOfPurchase: [],
      warrantyStart: body.purchaseDate,
      warrantyEnd: end.toISOString().slice(0, 10),
      status: "ACTIVE" as const,
      createdAt: new Date().toISOString(),
    };
    registrations.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  // ---- Claims -----------------------------------------------------------
  http.get(api("/claims"), async ({ request }) => {
    await delay(300);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.toUpperCase();
    const status = url.searchParams.get("status") as ClaimStatus | null;
    const filtered = claims.filter(
      (c) => (!q || c.id.includes(q) || c.serialNumber.includes(q)) && (!status || c.status === status),
    );
    return HttpResponse.json(paginate(sortBy(filtered, url.searchParams.get("sort") ?? "-updatedAt"), url));
  }),

  http.get(api("/claims/:id"), async ({ params }) => {
    await delay(200);
    const claim = claims.find((c) => c.id === params.id);
    if (!claim) return error(404, { code: "not_found", message: "Claim not found. Check the claim ID." });
    const user = currentMockUser();
    const customerView = user && (user.role === "technician" || user.role === "distributor");
    // Internal notes are never sent to technicians or distributors.
    return HttpResponse.json(
      customerView ? { ...claim, history: claim.history.filter((e) => !e.internal) } : claim,
    );
  }),

  http.post(api("/claims"), async ({ request }) => {
    await delay(200);
    const body = (await request.json()) as Partial<Claim>;
    const reg = registrations.find((r) => r.serialNumber === body.serialNumber);
    const now = new Date().toISOString();
    const claim: Claim = {
      id: `CLM-${String(claims.length + 1).padStart(6, "0")}`,
      registrationId: reg?.id ?? "",
      serialNumber: body.serialNumber ?? "",
      sku: reg?.sku ?? "",
      failureCategory: body.failureCategory ?? "other",
      description: body.description ?? "",
      failureDate: body.failureDate ?? "",
      attachments: [],
      status: "DRAFT",
      resolution: body.resolution,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    claims.unshift(claim);
    return HttpResponse.json(claim, { status: 201 });
  }),

  http.put(api("/claims/:id"), async ({ params, request }) => {
    const claim = claims.find((c) => c.id === params.id);
    if (!claim) return error(404, { code: "not_found", message: "Claim not found." });
    const body = (await request.json()) as Partial<Claim>;
    Object.assign(claim, {
      ...body,
      id: claim.id,
      status: claim.status,
      updatedAt: new Date().toISOString(),
    });
    return HttpResponse.json(claim);
  }),

  http.post(api("/claims/:id/transitions"), async ({ params, request }) => {
    await delay(300);
    const claim = claims.find((c) => c.id === params.id);
    if (!claim) return error(404, { code: "not_found", message: "Claim not found." });
    const body = (await request.json()) as { action: ClaimAction; comment?: string; reason?: string };
    const user = currentMockUser();
    const transition = CLAIM_TRANSITIONS.find(
      (t) => t.from === claim.status && t.action === body.action && (!user || t.roles.includes(user.role)),
    );
    if (!transition) {
      return error(409, {
        code: "invalid_transition",
        message: "This claim can't move to that status. Refresh and try again.",
      });
    }
    const updated: Claim = {
      ...claim,
      status: transition.to,
      rejectionReason: body.reason ?? claim.rejectionReason,
      updatedAt: new Date().toISOString(),
      history: [
        ...claim.history,
        {
          at: new Date().toISOString(),
          actor: {
            id: user?.id ?? "u-agent",
            name: user?.name ?? "Agent",
            role: user?.role ?? "claims_agent",
          },
          type: "status_changed",
          from: claim.status,
          to: transition.to,
          comment: body.comment,
        },
      ],
    };
    claims.splice(claims.indexOf(claim), 1, updated);
    return HttpResponse.json(updated);
  }),

  http.post(api("/claims/:id/comments"), async ({ params, request }) => {
    await delay(200);
    const claim = claims.find((c) => c.id === params.id);
    if (!claim) return error(404, { code: "not_found", message: "Claim not found." });
    const body = (await request.json()) as { comment: string; internal?: boolean };
    const user = currentMockUser() ?? mockUsers.claims_agent;
    const event = {
      at: new Date().toISOString(),
      actor: { id: user.id, name: user.name, role: user.role },
      type: "comment" as const,
      comment: body.comment,
      internal: body.internal,
    };
    claim.history.push(event);
    return HttpResponse.json(event, { status: 201 });
  }),

  // ---- RMA --------------------------------------------------------------
  http.get(api("/rma"), ({ request }) => HttpResponse.json(paginate(rmas, new URL(request.url)))),
  http.get(api("/rma/:id"), ({ params }) => {
    const rma = rmas.find((r) => r.id === params.id);
    return rma ? HttpResponse.json(rma) : error(404, { code: "not_found", message: "RMA not found." });
  }),

  // ---- Customers --------------------------------------------------------
  http.get(api("/customers"), ({ request }) => HttpResponse.json(paginate(customers, new URL(request.url)))),
  http.get(api("/customers/:id"), ({ params }) => {
    const customer = customers.find((c) => c.id === params.id);
    return customer
      ? HttpResponse.json(customer)
      : error(404, { code: "not_found", message: "Customer not found." });
  }),

  // ---- Dashboard --------------------------------------------------------
  http.get(api("/dashboard/summary"), async () => {
    await delay(250);
    const byStatus = claims.reduce<Partial<Record<ClaimStatus, number>>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {});
    return HttpResponse.json({
      registrationsThisMonth: { value: 128, change: 12.4, sparkline: [80, 92, 101, 97, 110, 128] },
      openClaims: {
        value: claims.filter((c) => !["CLOSED", "DRAFT", "REJECTED"].includes(c.status)).length,
        change: -4.2,
      },
      avgResolutionDays: { value: 6.3, change: -8.1 },
      slaBreached: { value: 3, change: 50 },
      unassigned: claims.filter((c) => !c.assignedTo).length,
      claimsByStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
    });
  }),

  // ---- Uploads ----------------------------------------------------------
  http.post(api("/uploads/presign"), async ({ request }) => {
    const body = (await request.json()) as { name: string; mime: string; size: number };
    const id = crypto.randomUUID();
    return HttpResponse.json({ id, uploadUrl: `https://mock-storage.local/${id}`, name: body.name });
  }),
  http.put("https://mock-storage.local/:id", async () => {
    await delay(500);
    return new HttpResponse(null, { status: 201 });
  }),
];
