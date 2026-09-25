// List conventions (api-contract "Lists"): ?page=1&pageSize=25&sort=-field&q=text, answered with
// { items, total, page, pageSize }. pageSize is clamped to 1..100 rather than rejected.

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface ListQuery {
  page: number;
  pageSize: number;
  sort?: string;
  q?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type RawQuery = Record<string, unknown>;

const positiveInt = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** A single string query value; repeated or non-string values are ignored. */
export const queryString = (query: RawQuery, key: string): string | undefined => {
  const value = query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

/** A query value that must be one of `allowed`; anything else is treated as "no filter". */
export function queryEnum<T extends string>(query: RawQuery, key: string, allowed: readonly T[]): T | undefined {
  const value = queryString(query, key);
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function listQuery(query: RawQuery): ListQuery {
  return {
    page: positiveInt(query.page) ?? 1,
    pageSize: Math.min(MAX_PAGE_SIZE, positiveInt(query.pageSize) ?? DEFAULT_PAGE_SIZE),
    sort: queryString(query, "sort")?.slice(0, 50),
    q: queryString(query, "q")?.slice(0, 100),
  };
}

export const pageArgs = ({ page, pageSize }: ListQuery) => ({ skip: (page - 1) * pageSize, take: pageSize });

export type SortDirection = "asc" | "desc";

/**
 * Resolves "-field" against an allow-list of sortable fields. The frontend may sort by any column it shows, so an
 * unknown field falls back to the default order instead of failing the page.
 */
export function resolveSort<T>(
  sort: string | undefined,
  allowed: Record<string, (dir: SortDirection) => T>,
  fallback: string,
): T {
  const pick = (spec: string) => {
    const dir: SortDirection = spec.startsWith("-") ? "desc" : "asc";
    return allowed[spec.replace(/^-/, "")]?.(dir);
  };
  return (sort ? pick(sort) : undefined) ?? pick(fallback)!;
}
