import { ErrorCode } from "../../common/errors/error-codes";
import { startOfUtcDay } from "../../common/time/utc-date";
import { serialMatchesProduct } from "../../common/validation/serial";

// Registration business rules (build guide Section 8.2), shared by the single endpoint and bulk import.
// Pure: returns the first broken rule instead of throwing, so imports can report per row.

export interface RuleViolation {
  code: ErrorCode;
  field: "serialNumber" | "sku" | "purchaseDate";
  message: string;
}

export function checkRegistrationRules(input: {
  serial: string;
  purchaseDate: Date;
  today: Date;
  product: { sku: string; serialPattern: string | null; launchDate: Date | null } | null;
}): RuleViolation | null {
  if (!input.product) {
    return {
      code: ErrorCode.PRODUCT_NOT_FOUND,
      field: "sku",
      message: "We don't recognise that product. Pick it from the list.",
    };
  }
  if (input.product.serialPattern && !serialMatchesProduct(input.serial, input.product)) {
    return {
      code: ErrorCode.SERIAL_FORMAT_INVALID,
      field: "serialNumber",
      message: `That doesn't look like a ${input.product.sku} serial number. Check the label on the unit.`,
    };
  }
  if (startOfUtcDay(input.purchaseDate) > startOfUtcDay(input.today)) {
    return {
      code: ErrorCode.PURCHASE_IN_FUTURE,
      field: "purchaseDate",
      message: "Purchase date can't be in the future.",
    };
  }
  if (input.product.launchDate && input.purchaseDate < input.product.launchDate) {
    return {
      code: ErrorCode.PURCHASE_BEFORE_LAUNCH,
      field: "purchaseDate",
      message: "Purchase date is before this product was released. Check the receipt.",
    };
  }
  return null;
}
