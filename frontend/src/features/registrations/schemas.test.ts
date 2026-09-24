import { addDaysIso, todayIso } from "@wms/domain";
import { selfRegisterSchema, unitRegisterSchema } from "./schemas";

/** First message per field, as the form shows it. */
const messages = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  Object.fromEntries([...(result.error?.issues ?? [])].reverse().map((i) => [i.path.join("."), i.message]));

describe("selfRegisterSchema (CU01)", () => {
  const valid = {
    serial: " aer-spl15-240917 ",
    modelCode: "AER-SPL15",
    purchaseDate: addDaysIso(todayIso(), -3),
    invoiceCount: 1,
  };

  it("accepts a QR-prefilled registration and normalises the serial", () => {
    const result = selfRegisterSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.serial).toBe("AER-SPL15-240917");
  });

  it("needs the invoice, a model and a past purchase date", () => {
    const result = selfRegisterSchema.safeParse({
      ...valid,
      modelCode: "",
      invoiceCount: 0,
      purchaseDate: addDaysIso(todayIso(), 1),
    });
    expect(messages(result)).toEqual({
      modelCode: "validation.pickModel",
      invoiceCount: "validation.invoiceRequired",
      purchaseDate: "rowErrors.future_date",
    });
  });

  it("rejects malformed serials and dates", () => {
    const result = selfRegisterSchema.safeParse({ ...valid, serial: "AB", purchaseDate: "15/09/2026" });
    expect(messages(result)).toMatchObject({ serial: "validation.serial", purchaseDate: "validation.date" });
  });
});

describe("unitRegisterSchema (DL03)", () => {
  const valid = {
    serial: "AER-SPL15-260950",
    modelCode: "AER-SPL15",
    installDate: todayIso(),
    customerName: "P. Kale",
    customerPhone: "+91 90000 00300",
    customerEmail: "",
  };

  it("accepts a dealer registration without a dealer field", () => {
    expect(unitRegisterSchema(false).safeParse(valid).success).toBe(true);
  });

  it("makes distributors and admins pick the dealer", () => {
    expect(messages(unitRegisterSchema(true).safeParse(valid))).toEqual({
      dealerId: "validation.pickDealer",
    });
    expect(unitRegisterSchema(true).safeParse({ ...valid, dealerId: "d-coolair" }).success).toBe(true);
  });

  it("needs install date and customer details, and checks the email", () => {
    const result = unitRegisterSchema(false).safeParse({
      ...valid,
      installDate: "",
      customerName: " ",
      customerPhone: "",
      customerEmail: "not-an-email",
    });
    expect(messages(result)).toEqual({
      installDate: "rowErrors.required",
      customerName: "rowErrors.required",
      customerPhone: "rowErrors.required",
      customerEmail: "validation.email",
    });
  });
});
