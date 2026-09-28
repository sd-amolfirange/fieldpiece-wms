import { Prisma, type PrismaClient } from "@prisma/client";
import type { IsoDate } from "@wms/domain";
import { toDbDateOpt } from "../../common/db/dates";
import { COUNTER_SEQUENCES, ID_SEQUENCES, setSequence } from "../../common/db/ids";
import { hashApiKey } from "../intake";
import { createSeed, DEMO_PARTNER_KEYS, type SeedState } from "./seed-data";

// Writes the starting data set, replacing every business record. Used by `npm run db:seed` and by Admin -> System
// events -> Reset. The seeded logins keep their ids (and signed-in sessions keep working); any other login is
// removed. Runs in one transaction: a failed reset changes nothing.

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
      const removedFileKeys = (await tx.attachment.findMany({ select: { storageKey: true } })).map(
        (a) => a.storageKey,
      );
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
  await tx.notification.deleteMany();
  await tx.warrantyClaimEvent.deleteMany();
  await tx.warrantyClaim.deleteMany();
  await tx.registration.deleteMany();
  await tx.bulkImportRow.deleteMany();
  await tx.bulkImport.deleteMany();
  await tx.unitEvent.deleteMany();
  await tx.unit.deleteMany();
  await tx.integrationMessage.deleteMany();
  await tx.attachment.deleteMany();
  await tx.partnerClient.deleteMany();
  // Logins that aren't part of the seed (their sessions cascade).
  await tx.user.deleteMany({ where: { id: { notIn: seed.users.map((u) => u.id) } } });
}

async function writeMasterData(
  tx: Tx,
  seed: SeedState,
  options: { now: Date; passwordHash: string },
): Promise<void> {
  // Seeded logins drop their organisation links first, so organisations can be replaced.
  await tx.user.updateMany({
    data: { role: "admin", dealerId: null, distributorId: null, customerId: null },
  });

  await tx.customer.deleteMany({ where: { id: { notIn: seed.customers.map((c) => c.id) } } });
  await tx.dealer.deleteMany({ where: { id: { notIn: seed.dealers.map((d) => d.id) } } });
  await tx.distributor.deleteMany({ where: { id: { notIn: seed.distributors.map((d) => d.id) } } });
  await tx.model.deleteMany({ where: { id: { notIn: seed.models.map((m) => m.id) } } });
  await tx.productCategory.deleteMany({ where: { id: { notIn: seed.categories.map((c) => c.id) } } });

  for (const [position, c] of seed.categories.entries()) {
    await tx.productCategory.upsert({
      where: { id: c.id },
      create: { ...c, position },
      update: { name: c.name, position },
    });
  }
  for (const [position, m] of seed.models.entries()) {
    const { id, ...rest } = m;
    const data = { ...rest, position };
    await tx.model.upsert({ where: { id }, create: { id, ...data }, update: data });
  }
  for (const [position, d] of seed.distributors.entries()) {
    const data = { name: d.name, city: d.city, state: d.state, position };
    await tx.distributor.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  for (const [position, d] of seed.dealers.entries()) {
    const data = {
      name: d.name,
      city: d.city,
      state: d.state,
      distributorId: d.distributorId ?? null,
      position,
    };
    await tx.dealer.upsert({ where: { id: d.id }, create: { id: d.id, ...data }, update: data });
  }
  for (const [i, c] of seed.customers.entries()) {
    const data = {
      name: c.name,
      phone: c.phone,
      email: c.email ?? null,
      city: c.city,
      state: c.state,
      zip: c.zip,
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
  for (const p of seed.partnerClients) {
    const apiKey = DEMO_PARTNER_KEYS[p.id];
    await tx.partnerClient.create({
      data: {
        id: p.id,
        name: p.name,
        channel: p.channel,
        dealerId: p.dealerId,
        keyHash: hashApiKey(apiKey),
        keyPrefix: apiKey.slice(0, 12),
        createdAt: options.now,
      },
    });
  }
}

async function writeRecords(tx: Tx, seed: SeedState): Promise<void> {
  await tx.registration.createMany({
    data: seed.registrations.map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      flags: r.flags,
      serial: r.serial,
      batchNumber: r.batchNumber ?? null,
      modelCode: r.modelCode,
      customerName: r.customer.name,
      customerPhone: r.customer.phone ?? null,
      customerEmail: r.customer.email ?? null,
      customerCity: r.customer.city ?? null,
      customerState: r.customer.state ?? null,
      customerZip: r.customer.zip ?? null,
      customerId: r.customerId ?? null,
      dealerId: r.dealerId ?? null,
      purchaseDate: toDbDateOpt(r.purchaseDate),
      invoiceNumber: r.invoiceNumber ?? null,
      placeOfPurchase: r.placeOfPurchase ?? null,
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

  await tx.unit.createMany({
    data: seed.units.map((u) => ({
      serial: u.serial,
      batchNumber: u.batchNumber ?? null,
      modelId: u.modelId,
      dealerId: u.dealerId ?? null,
      customerId: u.customerId ?? null,
      purchaseDate: toDbDateOpt(u.purchaseDate),
      placeOfPurchase: u.placeOfPurchase ?? null,
      warrantyStart: toDbDateOpt(u.warrantyStart),
      warrantyEnd: toDbDateOpt(u.warrantyEnd),
      registrationId: u.registrationId ?? null,
      replacesSerial: u.replacesSerial ?? null,
      replacedBySerial: u.replacedBySerial ?? null,
      attachmentIds: u.attachmentIds,
    })),
  });
  // Product events in the order they were recorded, product by product (ids keep that order for ties in time).
  await tx.unitEvent.createMany({
    data: seed.units.flatMap((u) =>
      [...u.history]
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((e) => ({
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

  for (const c of seed.claims) {
    await tx.warrantyClaim.create({
      data: {
        id: c.id,
        unitSerial: c.unitSerial,
        source: c.source,
        raisedBy: c.raisedBy,
        raisedByName: c.raisedByName,
        dealerId: c.dealerId ?? null,
        customerId: c.customerId ?? null,
        issueType: c.issueType,
        description: c.description,
        attachmentIds: c.attachmentIds,
        status: c.status,
        coverage: json(c.coverage),
        resolution: c.resolution ?? null,
        creditAmount: c.creditAmount === undefined ? null : new Prisma.Decimal(c.creditAmount),
        replacementSerial: c.replacementSerial ?? null,
        replacementBatchNumber: c.replacementBatchNumber ?? null,
        decisionNote: c.decisionNote ?? null,
        rejectReason: c.rejectReason ?? null,
        reviewedByName: c.reviewedByName ?? null,
        createdAt: new Date(c.createdAt),
        updatedAt: new Date(c.updatedAt),
        events: {
          createMany: {
            data: c.history.map((e) => ({
              at: new Date(e.at),
              status: e.status,
              byName: e.byName,
              text: e.text ?? null,
            })),
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

/** Ids continue after the seed's (REG-1014 -> REG-1015); unused prefixes start at 1001. */
async function resetSequences(tx: Tx, seed: SeedState): Promise<void> {
  for (const [prefix, sequence] of Object.entries(ID_SEQUENCES)) {
    await setSequence(tx, sequence, seed.counters[prefix] ?? 1000);
  }
  for (const sequence of Object.values(COUNTER_SEQUENCES)) await setSequence(tx, sequence, 0);
}
