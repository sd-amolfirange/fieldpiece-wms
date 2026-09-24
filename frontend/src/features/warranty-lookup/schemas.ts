import { z } from "zod";
import { DEFAULT_SERIAL_PATTERN } from "@/lib/serial";
import { normalizeSerial } from "@/lib/format";

export const warrantyCheckSchema = z.object({
  serial: z
    .string()
    .transform(normalizeSerial)
    .pipe(
      z
        .string()
        .min(1, "Enter the serial number.")
        .regex(
          new RegExp(DEFAULT_SERIAL_PATTERN),
          "That doesn't look like a valid serial number. Check the label on the unit.",
        ),
    ),
});

export type WarrantyCheckForm = z.input<typeof warrantyCheckSchema>;
