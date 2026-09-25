import { createBody, emailKey, phoneKey, rowFieldErrors, rowInput, rowToFields } from "./registration-input";

describe("registration input", () => {
  it("keeps only known fields, as strings", () => {
    expect(rowInput({ serial: "ab-123456", modelCode: 7, extra: "x", customerName: { evil: true } })).toEqual({
      serial: "ab-123456",
      modelCode: "7",
    });
    expect(rowInput(null)).toEqual({});
  });

  it("parses the create body", () => {
    expect(createBody({ serial: "S", attachmentIds: ["a", 3, "b"], dealerId: "d-1" })).toMatchObject({
      serial: "S",
      attachmentIds: ["a", "b"],
      dealerId: "d-1",
    });
  });

  it("normalises a row into registration fields", () => {
    expect(
      rowToFields({ serial: " aer-spl15 240917 ", modelCode: " aer-spl15 ", customerName: " A. Joshi ", city: "" }),
    ).toEqual({
      serial: "AER-SPL15240917",
      modelCode: "AER-SPL15",
      customer: { name: "A. Joshi", phone: undefined, email: undefined, city: undefined },
      installDate: undefined,
      invoiceNumber: undefined,
    });
  });

  it("maps row errors to i18n keys", () => {
    expect(rowFieldErrors({ serial: "duplicate_serial", installDate: "future_date" })).toEqual({
      serial: "rowErrors.duplicate_serial",
      installDate: "rowErrors.future_date",
    });
  });

  it("builds customer matching keys", () => {
    expect(phoneKey("+91 90000 00101")).toBe("9000000101");
    expect(phoneKey("")).toBeUndefined();
    expect(emailKey(" R.K@Demo.WMS ")).toBe("r.k@demo.wms");
  });
});
