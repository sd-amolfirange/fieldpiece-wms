import type { Prisma, PrismaClient } from "@prisma/client";
import type { IsoDate } from "@wms/domain";
import { toDbDate, toDbDateOpt } from "../../common/db/dates";
import { COUNTER_SEQUENCES, ID_SEQUENCES, setSequence } from "../../common/db/ids";
import { createSeed, type SeedState } from "./seed-data";

// Writes the demo data set, replacing every business record. Used by `npm run db:seed` and by Admin -> Simulate ->
// Reset. The seeded logins keep their ids (and signed-in sessions keep working, as with the mock server); any
// other login is removed. Runs in one transaction: a failed reset changes nothing.

type Tx = Prisma.TransactionClient;

const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
const phoneKey = (phone?: string) => (phone ?? "").replace(/\D/g, "").slice(-10) || null;

/** Storage keys of the files the reset removes, so the caller can delete the bytes after the commit. */
export async function writeSeed(
  db: PrismaClient,
  options: { today: IsoDate; now: Date; passwordHash: string },
): Promise<{ removedFileKeys: string[] }> {
  const seed = createSeed(options.today);
  return db.$transaction(
    async (tx) => {
      const removedFileKeys = (await tx.attachment.findMany({ select: { storageKey: true } })).map((a) => a.storageKey);
      await clearBusinessData(tx, seed);
      await writeMasterData(tx, seed, options);
      await writeRecords(tx, seed);
      await resetSequences(tx, seed);
      return { removedFileKeys };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}

async function clearBusinessData(tx: Tx, seed: SeedState): Promise<void> {
  // Children first (most also cascade, but explicit order keeps FK checks cheap and obvious).
  await tx.notification.deleteMany();
  await tx.claimEvent.deleteMany();
  await tx.claim.deleteMany();
  await tx.jobResult.deleteMany();
  await tx.complaintEvent.deleteMany();
  await tx.complaint.deleteMany();
  await tx.registration.deleteMany();
  await tx.bulkImportRow.deleteMany();
  await tx.bulkImport.deleteMany();
  await tx.unitEvent.deleteMany();
  await tx.unitPart.deleteMany();
  await tx.unit.deleteMany();
  await tx.integrationMessage.deleteMany();
  await tx.attachment.deleteMany();
  // Logins that aren't part of the seed (their sessions cascade).
  await tx.user.deleteMany({ where: { id: { notIn: seed.users.map((u) => u.id) } } });
}

async function writeMasterData(tx: Tx, seed: SeedState, options: { now: Date; passwordHash: string }): Promise<void> {
  // Seeded logins drop their organisation links first, so organisations can be replaced.
  await tx.user.updateMany({ data: { role: "admin", dealerId: null, distributorId: null, customerId: null } });

  await tx.customer.deleteMany({ where: { id: { notIn: seed.customers.map((c) => c.id) } } });
  await tx.dealer.deleteMany({ where: { id: { notIn: seed.dealers.map((d) => d.id) } } });
  await tx.distributor.deleteMany({ where: { id: { notIn: seed.distributors.map((d) => d.id) } } });
  await tx.modelPart.deleteMany();
  await tx.model.deleteMany({ where: { id: { notIn: seed.models.map((m) => m.id) } } });
  await tx.brand.deleteMany({ where: { id: { notIn: seed.brands.map((b) => b.id) } } });

  for (const [position, b] of seed.brands.entries()) {
    await tx.brand.upsert({ where: { id: b.id }, create: { ...b, position }, update: { name: b.name, position } });
  }
  for (const [position, m] of seed.models.entries()) {
    const data = { code: m.code, brandId: m.brandId, name: m.name, capacity: m.capacity, type: m.type, position };
    await tx.model.upsert({ where: { id: m.id }, create: { id: m.id, ...data }, update: data });
    await tx.modelPart.createMany({ data: m.parts.map((p, i) => ({ modelId: m.id, position: i, ...p })) });
  }
  for (const [position, d] of seed.distributors.entries()) {
    const data = { name: d.name, city: d.city, position };
    await tx.distributor.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  for (const [position, d] of seed.dealers.entries()) {
    const data = { name: d.name, city: d.city, distributorId: d.distributorId ?? null, position };
    await tx.dealer.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  for (const [i, c] of seed.customers.entries()) {
    const data = {
      name: c.name,
      phone: c.phone,
      email: c.email ?? null,
      city: c.city,
      phoneKey: phoneKey(c.phone),
      emailKey: c.email?.toLowerCase() ?? null,
      createdAt: new Date(options.now.getTime() - (seed.customers.length - i) * 1000),
    };
    await tx.customer.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
  }
  for (const [i, u] of seed.users.entries()) {
    const data = {
      name: u.name,
      email: u.email.toLowerCase(),
      role: u.role,
      dealerId: u.dealerId ?? null,
      distributorId: u.distributorId ?? null,
      customerId: u.customerId ?? null,
      passwordHash: options.passwordHash,
      isActive: true,
      // Keeps the seed order in account lists.
      createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000),
    };
    await tx.user.upsert({ where: { id: u.id }, create: { id: u.id, ...data }, update: data });
  }
}

async function writeRecords(tx: Tx, seed: SeedState): Promise<void> {
  // Registrations first: units reference them by id.
  await tx.registration.createMany({
    data: seed.registrations.map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      flags: r.flags,
      serial: r.serial,
      modelCode: r.modelCode,
      customerName: r.customer.name,
      customerPhone: r.customer.phone ?? null,
      customerEmail: r.customer.email ?? null,
      customerCity: r.customer.city ?? null,
      customerId: r.customerId ?? null,
      dealerId: r.dealerId ?? null,
      installDate: toDbDateOpt(r.installDate),
      purchaseDate: toDbDateOpt(r.purchaseDate),
      invoiceNumber: r.invoiceNumber ?? null,
      location: r.location ?? null,
      attachmentIds: r.attachmentIds,
      submittedBy: r.submittedBy,
      submittedByName: r.submittedByName,
      submittedAt: new Date(r.submittedAt),
      duplicateOfSerial: r.duplicateOfSerial ?? null,
      rejectReason: r.rejectReason ?? null,
      reviewedByName: r.reviewedByName ?? null,
      reviewedAt: r.reviewedAt ? new Date(r.reviewedAt) : null,
    })),
  });

  for (const u of seed.units) {
    await tx.unit.create({
      data: {
        serial: u.serial,
        modelId: u.modelId,
        brandId: u.brandId,
        dealerId: u.dealerId ?? null,
        customerId: u.customerId ?? null,
        location: u.location ?? null,
        installDate: toDbDateOpt(u.installDate),
        purchaseDate: toDbDateOpt(u.purchaseDate),
        registrationId: u.registrationId ?? null,
        attachmentIds: u.attachmentIds,
        parts: {
          createMany: {
            data: u.parts.map((p, position) => ({
              id: p.id,
              position,
              partType: p.partType,
              serial: p.serial ?? null,
              warrantyStart: toDbDate(p.warrantyStart),
              warrantyEnd: toDbDate(p.warrantyEnd),
              coversParts: p.coversParts,
              coversLabour: p.coversLabour,
              replacedAt: toDbDateOpt(p.replacedAt),
              replacedBySerial: p.replacedBySerial ?? null,
              replacesSerial: p.replacesSerial ?? null,
            })),
          },
        },
      },
    });
  }
  // Unit events in the order they were recorded, unit by unit (ids keep that order for ties in time).
  await tx.unitEvent.createMany({
    data: seed.units.flatMap((u) =>
      u.history.map((e) => ({
        unitSerial: u.serial,
        at: new Date(e.at),
        type: e.type,
        byName: e.byName,
        text: e.text ?? null,
        reason: e.reason ?? null,
        refId: e.refId ?? null,
      })),
    ),
  });

  for (const c of seed.complaints) {
    await tx.complaint.create({
      data: {
        id: c.id,
        unitSerial: c.unitSerial,
        source: c.source,
        raisedBy: c.raisedBy,
        raisedByName: c.raisedByName,
        dealerId: c.dealerId ?? null,
        customerId: c.customerId ?? null,
        description: c.description,
        attachmentIds: c.attachmentIds,
        status: c.status,
        entitlement: json(c.entitlement),
        serviceRequestId: c.serviceRequestId ?? null,
        jobResultId: c.jobResultId ?? null,
        claimId: c.claimId ?? null,
        createdAt: new Date(c.createdAt),
        events: {
          createMany: {
            data: c.history.map((e) => ({ at: new Date(e.at), status: e.status, byName: e.byName, text: e.text ?? null })),
          },
        },
      },
    });
  }
  await tx.jobResult.createMany({
    data: seed.jobResults.map((j) => ({
      id: j.id,
      complaintId: j.complaintId,
      technician: j.technician,
      completedAt: new Date(j.completedAt),
      partsReplaced: json(j.partsReplaced),
      photoIds: j.photoIds,
      signOffName: j.signOffName,
      notes: j.notes ?? null,
    })),
  });
  for (const c of seed.claims) {
    await tx.claim.create({
      data: {
        id: c.id,
        complaintId: c.complaintId ?? null,
        unitSerial: c.unitSerial,
        brandId: c.brandId,
        dealerId: c.dealerId ?? null,
        status: c.status,
        rmaNumber: c.rmaNumber ?? null,
        amount: c.amount ?? null,
        jobResultId: c.jobResultId ?? null,
        photoIds: c.photoIds,
        partsReplaced: json(c.partsReplaced),
        financePosting: c.financePosting,
        rejectReason: c.rejectReason ?? null,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        events: {
          createMany: {
            data: c.history.map((e) => ({ at: new Date(e.at), status: e.status, byName: e.byName, text: e.text ?? null })),
          },
        },
      },
    });
  }
  await tx.integrationMessage.createMany({
    data: seed.integrations.map((m) => ({
      id: m.id,
      system: m.system,
      direction: m.direction,
      type: m.type,
      status: m.status,
      payload: json(m.payload),
      attempts: m.attempts,
      lastError: m.lastError ?? null,
      refId: m.refId ?? null,
      createdAt: new Date(m.createdAt),
      updatedAt: new Date(m.updatedAt),
    })),
  });
}

/** Ids continue after the seed's (REG-1017 -> REG-1018); unused prefixes start at 1001. */
async function resetSequences(tx: Tx, seed: SeedState): Promise<void> {
  for (const [prefix, sequence] of Object.entries(ID_SEQUENCES)) {
    await setSequence(tx, sequence, seed.counters[prefix] ?? 1000);
  }
  for (const sequence of Object.values(COUNTER_SEQUENCES)) await setSequence(tx, sequence, 0);
}
