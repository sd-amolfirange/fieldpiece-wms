import type { IsoDate } from "@wms/domain";

// Postgres DATE columns come back from Prisma as a Date at 00:00 UTC. These helpers convert between that and the
// domain's yyyy-MM-dd strings without ever passing through local time.

export const toDbDate = (date: IsoDate): Date => new Date(`${date}T00:00:00.000Z`);

export const fromDbDate = (date: Date): IsoDate => date.toISOString().slice(0, 10);

export const toDbDateOpt = (date: IsoDate | undefined | null): Date | null => (date ? toDbDate(date) : null);

export const fromDbDateOpt = (date: Date | null | undefined): IsoDate | undefined =>
  date ? fromDbDate(date) : undefined;

/** Null columns become absent fields, as in the domain types (`field?: T`). */
export const opt = <T>(value: T | null | undefined): T | undefined => value ?? undefined;
