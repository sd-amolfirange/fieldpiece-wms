import type { Prisma } from "@prisma/client";

/** Converts a value to JSON-safe data for jsonb columns (Dates -> ISO strings, BigInt/Decimal -> strings). */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}
