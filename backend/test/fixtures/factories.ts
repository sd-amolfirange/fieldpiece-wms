import type { ClaimStatus, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { addUtcDays, startOfUtcDay } from "../../src/common/time/utc-date";

// Test factories (Section 13.2). Tests build exactly what they need; they never depend on seed data.

const today = () => startOfUtcDay(new Date());
const address = { line1: "1 Test St", city: "Fresno", region: "CA", postalCode: "93650", country: "US" };

export interface World {
  orgs: { fieldpiece: string; distA: string; distB: string; serviceCenter: string };
  users: Record<
    "tech" | "tech2" | "distA" | "distB" | "agent" | "agent2" | "svc" | "admin",
    { id: string; email: string }
  >;
  product: { id: string; sku: string };
  policyId: string;
}

/** Organisations, one user per role (plus a second tech, distributor and agent), a product and a policy. */
export async function buildWorld(db: PrismaClient): Promise<World> {
  const org = async (type: string, name: string, withAddress = false) =>
    (await db.organization.create({ data: { type, name, address: withAddress ? address : undefined } })).id;
  const orgs = {
    fieldpiece: await org("fieldpiece", "Fieldpiece"),
    distA: await org("distributor", "Distributor A"),
    distB: await org("distributor", "Distributor B"),
    serviceCenter: await org("service_center", "Service Center", true),
  };

  const user = async (key: string, roles: string[], organizationId: string | null = null) => {
    const email = `${key}@test.local`;
    const u = await db.user.create({
      data: { idpSubject: `dev|${key}`, email, displayName: key, roles, organizationId },
    });
    return { id: u.id, email };
  };
  const users = {
    tech: await user("tech", ["technician"]),
    tech2: await user("tech2", ["technician"]),
    distA: await user("dista", ["distributor"], orgs.distA),
    distB: await user("distb", ["distributor"], orgs.distB),
    agent: await user("agent", ["claims_agent"], orgs.fieldpiece),
    agent2: await user("agent2", ["claims_agent"], orgs.fieldpiece),
    svc: await user("svc", ["service_center"], orgs.serviceCenter),
    admin: await user("admin", ["admin"], orgs.fieldpiece),
  };

  await db.failureCategory.createMany({
    data: [
      { code: "no_power", label: "No power" },
      { code: "display", label: "Display", requiresPhoto: true },
    ],
  });
  const product = await db.product.create({
    data: {
      sku: "SC680",
      name: "Clamp meter",
      family: "meters",
      launchDate: new Date("2019-01-01T00:00:00Z"),
    },
  });
  const policy = await db.warrantyPolicy.create({
    data: { productId: null, baseMonths: 24, effectiveFrom: new Date("2015-01-01T00:00:00Z") },
  });
  return { orgs, users, product: { id: product.id, sku: product.sku }, policyId: policy.id };
}

export async function makeRegistration(
  db: PrismaClient,
  world: World,
  opts: {
    createdBy: string;
    distributorId?: string | null;
    serial?: string;
    customerUserId?: string | null;
  } = { createdBy: "" },
) {
  const customer = await db.customer.create({
    data: {
      contactName: "Owner",
      address,
      userId: opts.customerUserId ?? null,
      distributorId: opts.distributorId ?? null,
    },
  });
  return db.registration.create({
    data: {
      serialNumber: opts.serial ?? `SC680-${randomUUID().slice(0, 8).toUpperCase()}`,
      productId: world.product.id,
      customerId: customer.id,
      distributorId: opts.distributorId ?? null,
      policyId: world.policyId,
      purchaseDate: addUtcDays(today(), -30),
      warrantyStart: addUtcDays(today(), -30),
      warrantyEnd: addUtcDays(today(), 700),
      createdBy: opts.createdBy,
    },
  });
}

export async function makeClaim(
  db: PrismaClient,
  opts: { registrationId: string; createdBy: string; status?: ClaimStatus; assignedTo?: string },
) {
  return db.claim.create({
    data: {
      registrationId: opts.registrationId,
      failureCategory: "no_power",
      description: "The unit will not power on with fresh batteries installed.",
      failureDate: addUtcDays(today(), -1),
      inWarranty: true,
      status: opts.status ?? "DRAFT",
      assignedTo: opts.assignedTo,
      submittedAt: opts.status && opts.status !== "DRAFT" ? new Date() : null,
      createdBy: opts.createdBy,
    },
  });
}
