import { HttpStatus } from "@nestjs/common";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { ErrorCode } from "../errors/error-codes";

// List conventions (Section 6.3): ?page=1&pageSize=25&sort=-createdAt&q=...
// pageSize is capped at 100 (not rejected); sort fields come from a per-endpoint allow-list.

export const MAX_PAGE_SIZE = 100;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .default(25)
    .transform((n) => Math.min(n, MAX_PAGE_SIZE)),
  sort: z.string().max(50).optional(),
  q: z.string().trim().max(100).optional(),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const pageArgs = ({ page, pageSize }: PageQuery) => ({ skip: (page - 1) * pageSize, take: pageSize });

type Direction = "asc" | "desc";

/**
 * Turns "-createdAt" into a Prisma orderBy using an allow-list. Unknown fields are a 400, never
 * interpolated anywhere. A stable tie-breaker should be included by the caller.
 */
export function orderByFrom<T>(
  sort: string | undefined,
  allowed: Record<string, (dir: Direction) => T>,
  fallback: string,
): T {
  const raw = sort ?? fallback;
  const dir: Direction = raw.startsWith("-") ? "desc" : "asc";
  const field = raw.replace(/^-/, "");
  const build = allowed[field];
  if (!build) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Unsupported sort field.", {
      sort: [`Use one of: ${Object.keys(allowed).join(", ")}`],
    });
  }
  return build(dir);
}

/** Wraps a zod item schema into the list envelope, for Swagger. */
export const paginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
