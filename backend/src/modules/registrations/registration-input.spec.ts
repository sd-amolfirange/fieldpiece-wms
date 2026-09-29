import {
  createBody,
  emailKey,
  isUsState,
  isUsZip,
  phoneKey,
  rowFieldErrors,
  rowInput,
  rowToFields,
} from "./registration-input";

describe("registration input", () => {
  it("keeps only known fields, as strings", () => {
    expect(rowInput({ serial: "SC680-251406233", modelCode: 7, extra: "x", customerName: { evil: true } })).toEqual(
      {
        serial: "SC680-251406233",
        modelCode: "7",
      },
    );
    expect(rowInput(null)).toEqual({});
  });

  it("parses the create body", () => {
    expect(
      createBody({ serial: "S", attachmentIds: ["a", 3, "b"], dealerId: "d-1", placeOfPurchase: "Store" }),
    ).toMatchObject({
      serial: "S",
      attachmentIds: ["a", "b"],
      dealerId: "d-1",
      placeOfPurchase: "Store",
    });
  });

  it("normalises a row into registration fields", () => {
    expect(
      rowToFields({
        serial: " 2514 06233 ",
        batchNumber: " 2514-l01 ",
        modelCode: " sc680 ",
        customerName: " Alicia Parker ",
        state: "tx",
        city: "",
      }),
    ).toEqual({
      serial: "SC680-251406233",
      batchNumber: "2514-L01",
      modelCode: "SC680",
      customer: {
        name: "Alicia Parker",
        phone: undefined,
        email: undefined,
        city: undefined,
        state: "TX",
        zip: undefined,
      },
      purchaseDate: undefined,
      invoiceNumber: undefined,
    });
  });

  it("maps row errors to i18n keys", () => {
    expect(
      rowFieldErrors({
        serial: "duplicate_serial",
        purchaseDate: "future_date",
        batchNumber: "invalid_batch",
      }),
    ).toEqual({
      serial: "rowErrors.duplicate_serial",
      purchaseDate: "rowErrors.future_date",
      batchNumber: "rowErrors.invalid_batch",
    });
  });

  it("builds customer matching keys", () => {
    expect(phoneKey("+1 (713) 555-0142")).toBe("7135550142");
    expect(phoneKey("")).toBeUndefined();
    expect(emailKey(" Marcus.Reed@Example.com ")).toBe("marcus.reed@example.com");
  });

  it("checks US ZIP codes and state codes", () => {
    expect(isUsZip("77008")).toBe(true);
    expect(isUsZip("77008-1234")).toBe(true);
    expect(isUsZip("7700")).toBe(false);
    expect(isUsState("TX")).toBe(true);
    expect(isUsState("Texas")).toBe(false);
    expect(isUsZip(undefined)).toBe(true);
  });
});
