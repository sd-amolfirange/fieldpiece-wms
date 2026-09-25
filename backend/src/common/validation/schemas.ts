import { z } from "zod";
import { parseIsoDate } from "../time/utc-date";

// Shared input schemas (Section 11.2). Unknown fields are stripped by zod's default object parsing.

/** "YYYY-MM-DD" that is a real calendar date. */
export const isoDateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
  .refine((value) => {
    try {
      parseIsoDate(value);
      return true;
    } catch {
      return false;
    }
  }, "Not a real date.");

/** Serials are normalised with trim().toUpperCase() (Section 8.2); inner spaces are removed too. */
export const serialNumber = z
  .string()
  .transform((s) => s.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().min(3, "Enter the serial number.").max(40, "That serial number is too long."));

export const uuid = z.string().uuid("Must be a valid ID.");

export const addressSchema = z.object({
  line1: z.string().trim().min(1, "Enter the street address.").max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "Enter the city.").max(100),
  region: z.string().trim().min(1, "Enter the state or province.").max(100),
  postalCode: z.string().trim().min(1, "Enter the postal code.").max(20),
  country: z
    .string()
    .trim()
    .length(2, "Use the 2-letter country code, e.g. US.")
    .transform((c) => c.toUpperCase()),
});
export type Address = z.infer<typeof addressSchema>;

/** Comma-separated enum list in a query string: ?status=SUBMITTED,IN_REVIEW */
export const csvEnum = <T extends [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).min(1));

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email, like name@company.com.");
