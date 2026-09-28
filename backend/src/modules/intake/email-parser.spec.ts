import { normalizeDate, parseRegistrationEmail, parseSender } from "./email-parser";

describe("parseRegistrationEmail", () => {
  it("reads the registration fields from an invoice email", () => {
    expect(
      parseRegistrationEmail({
        from: "Samantha Ortiz <SAM.ORTIZ@example.com>",
        subject: "Warranty registration",
        text: [
          "Hi, please register my new tool.",
          "Model: SM482V",
          "Serial number: 243100482",
          "Lot #: 2431-L04",
          "Purchased: 9/2/2026",
          "Invoice: GS-448120",
          "Phone: (214) 555-0147",
          "City: Plano",
          "State: TX",
          "ZIP: 75024",
        ].join("\n"),
      }),
    ).toEqual({
      modelCode: "SM482V",
      serial: "243100482",
      batchNumber: "2431-L04",
      purchaseDate: "2026-09-02",
      invoiceNumber: "GS-448120",
      customerPhone: "(214) 555-0147",
      city: "Plano",
      state: "TX",
      zip: "75024",
      customerEmail: "sam.ortiz@example.com",
      customerName: "Samantha Ortiz",
    });
  });

  it("accepts S/N and ISO dates, and takes the name from the message when given", () => {
    const row = parseRegistrationEmail({
      from: "tech@example.com",
      text: "S/N 241807532\nModel SC680\nPurchase date: 2026-08-30\nName: Luis Garza",
    });
    expect(row).toMatchObject({
      serial: "241807532",
      modelCode: "SC680",
      purchaseDate: "2026-08-30",
      customerName: "Luis Garza",
    });
  });

  it("leaves what it can't read empty and falls back to the sender", () => {
    expect(parseRegistrationEmail({ from: "pat@example.com", text: "Please register my meter." })).toEqual({
      customerEmail: "pat@example.com",
      customerName: "pat",
    });
  });
});

describe("helpers", () => {
  it("normalises US dates", () => {
    expect(normalizeDate("09/02/2026")).toBe("2026-09-02");
    expect(normalizeDate("2026-09-02")).toBe("2026-09-02");
  });

  it("splits a sender header", () => {
    expect(parseSender('"Pat Lee" <pat@example.com>')).toEqual({ name: "Pat Lee", email: "pat@example.com" });
    expect(parseSender("nonsense")).toEqual({});
  });
});
