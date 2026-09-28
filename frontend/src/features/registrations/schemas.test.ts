import { addDaysIso, todayIso } from "@wms/domain";
import { publicRegisterSchema, selfRegisterSchema, unitRegisterSchema } from "./schemas";

/** First message per field, as the form shows it. */
const messages = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) =>
  Object.fromEntries([...(result.error?.issues ?? [])].reverse().map((i) => [i.path.join("."), i.message]));

describe("selfRegisterSchema (CU01)", () => {
  const valid = {
    serial: " 2618 04517 ",
    batchNumber: "2618-l02",
    modelCode: "SM482V",
    purchaseDate: addDaysIso(todayIso(), -3),
    invoiceCount: 1,
  };

  it("accepts a QR-prefilled registration and normalises serial and batch", () => {
    const result = selfRegisterSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.serial).toBe("261804517");
    expect(result.data?.batchNumber).toBe("2618-L02");
  });

  it("needs the receipt, a model and a past purchase date", () => {
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
    const result = selfRegisterSchema.safeParse({ ...valid, serial: "AB", purchaseDate: "09/15/2026" });
    expect(messages(result)).toMatchObject({ serial: "validation.serial", purchaseDate: "validation.date" });
  });
});

describe("unitRegisterSchema (DL03)", () => {
  const valid = {
    serial: "263510457",
    batchNumber: "2635-L01",
    modelCode: "SC680",
    purchaseDate: todayIso(),
    customerName: "Alex Rivera",
    customerPhone: "(713) 555-0100",
    customerEmail: "",
    state: "tx",
    zip: "77002",
  };

  it("accepts a dealer registration without a dealer field", () => {
    const result = unitRegisterSchema(false).safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.state).toBe("TX");
  });

  it("makes distributors and admins pick the dealer", () => {
    expect(messages(unitRegisterSchema(true).safeParse(valid))).toEqual({
      dealerId: "validation.pickDealer",
    });
    expect(unitRegisterSchema(true).safeParse({ ...valid, dealerId: "d-lonestar" }).success).toBe(true);
  });

  it("needs batch, purchase date and customer details, and checks email, state and ZIP", () => {
    const result = unitRegisterSchema(false).safeParse({
      ...valid,
      batchNumber: "",
      purchaseDate: "",
      customerName: " ",
      customerPhone: "",
      customerEmail: "not-an-email",
      state: "Texas",
      zip: "7700",
    });
    expect(messages(result)).toEqual({
      batchNumber: "rowErrors.required",
      purchaseDate: "rowErrors.required",
      customerName: "rowErrors.required",
      customerPhone: "rowErrors.required",
      customerEmail: "validation.email",
      state: "validation.state",
      zip: "validation.zip",
    });
  });
});

describe("publicRegisterSchema (website form)", () => {
  const valid = {
    serial: "263510458",
    modelCode: "SC680",
    purchaseDate: addDaysIso(todayIso(), -10),
    customerName: "Jordan Lee",
    customerEmail: "jordan.lee@example.com",
    invoiceCount: 1,
  };

  it("accepts a buyer's registration with an email and a receipt", () => {
    expect(publicRegisterSchema.safeParse(valid).success).toBe(true);
  });

  it("needs a reachable email and the receipt", () => {
    expect(
      messages(publicRegisterSchema.safeParse({ ...valid, customerEmail: "", invoiceCount: 0 })),
    ).toEqual({
      customerEmail: "validation.email",
      invoiceCount: "validation.invoiceRequired",
    });
  });
});
