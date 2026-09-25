import type { Db } from "../../infra/prisma/prisma.service";

// Readable ids ("REG-1001", "CLM-1004"), one Postgres sequence per prefix (see the init migration). Sequences
// never hand out the same value twice, even across concurrent transactions.

export const ID_SEQUENCES = {
  REG: "id_seq_reg",
  CUS: "id_seq_cus",
  CMP: "id_seq_cmp",
  SR: "id_seq_sr",
  JOB: "id_seq_job",
  CLM: "id_seq_clm",
  MSG: "id_seq_msg",
  NTF: "id_seq_ntf",
  ATT: "id_seq_att",
  BLK: "id_seq_blk",
  USR: "id_seq_usr",
} as const;

export type IdPrefix = keyof typeof ID_SEQUENCES;

/** Counters that aren't ids. */
export const COUNTER_SEQUENCES = {
  ERPINV: "counter_erpinv",
  NEWPART: "counter_newpart",
} as const;

export type CounterName = keyof typeof COUNTER_SEQUENCES;

const next = async (db: Db, sequence: string): Promise<number> => {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval(${sequence}::regclass) AS n`;
  return Number(row!.n);
};

export async function nextId(db: Db, prefix: IdPrefix): Promise<string> {
  return `${prefix}-${await next(db, ID_SEQUENCES[prefix])}`;
}

export const nextCounter = (db: Db, name: CounterName): Promise<number> => next(db, COUNTER_SEQUENCES[name]);

/** Sets a sequence so the next value is `lastUsed + 1` (seed and reset only). */
export async function setSequence(db: Db, sequence: string, lastUsed: number): Promise<void> {
  // setval(seq, n, false) makes the next nextval() return n.
  await db.$queryRaw`SELECT setval(${sequence}::regclass, ${lastUsed + 1}, false)`;
}
