import {
  claimActionsFor,
  isOpenClaim,
  nextClaimStatus,
} from "./claim-transitions";
import {
  DEFAULT_BATCH_PATTERN,
  DEFAULT_SERIAL_PATTERN,
  isModelSerial,
  modelFormat,
  modelSerial,
  needsAdminReview,
  serialNumberPart,
  validateRegistrationRow,
  type RowContext,
} from "./registration-rules";

describe("validateRegistrationRow", () => {
  const format = modelFormat({
    serialPattern: DEFAULT_SERIAL_PATTERN,
    batchPattern: DEFAULT_BATCH_PATTERN,
  });
  const ctx: RowContext = {
    models: new Map([
      ["SC680", format],
      ["SM482V", format],
    ]),
    existingSerials: new Set(["SC680-241807532"]),
    seenInFile: new Set(["SC680-243500118"]),
    today: "2026-09-24",
  };
  const valid = {
    serial: " 243500101 ",
    batchNumber: "2435-l02",
    modelCode: "sc680",
    purchaseDate: "2026-09-15",
    customerName: "Carlos Mendez",
  };

  it("accepts a clean row (serial, batch and model are normalised)", () => {
    expect(validateRegistrationRow(valid, ctx)).toEqual({});
  });

  it("flags unknown models, duplicates and missing purchase dates", () => {
    expect(validateRegistrationRow({ ...valid, modelCode: "SC999" }, ctx)).toEqual({
      modelCode: "unknown_model",
    });
    expect(validateRegistrationRow({ ...valid, serial: "241807532" }, ctx)).toEqual({
      serial: "duplicate_serial",
    });
    expect(validateRegistrationRow({ ...valid, purchaseDate: "" }, ctx)).toEqual({
      purchaseDate: "required",
    });
  });

  it("accepts the full MODEL-NUMBER serial too, and a duplicate typed either way", () => {
    expect(validateRegistrationRow({ ...valid, serial: "sc680-243500101" }, ctx)).toEqual({});
    expect(validateRegistrationRow({ ...valid, serial: "SC680-241807532" }, ctx).serial).toBe(
      "duplicate_serial",
    );
  });

  it("checks the serial and batch against the model's format", () => {
    expect(validateRegistrationRow({ ...valid, serial: "SC680-12345" }, ctx).serial).toBe(
      "invalid_serial",
    );
    // Another model's prefix is never silently re-labelled.
    expect(validateRegistrationRow({ ...valid, serial: "SM482V-243500101" }, ctx).serial).toBe(
      "invalid_serial",
    );
    expect(validateRegistrationRow({ ...valid, batchNumber: "L02" }, ctx).batchNumber).toBe(
      "invalid_batch",
    );
    expect(validateRegistrationRow({ ...valid, batchNumber: "" }, ctx).batchNumber).toBe(
      "required",
    );
  });

  it("catches bad dates, repeats in the file and missing names", () => {
    expect(validateRegistrationRow({ ...valid, purchaseDate: "09/15/2026" }, ctx).purchaseDate).toBe(
      "invalid_date",
    );
    expect(validateRegistrationRow({ ...valid, purchaseDate: "2026-09-25" }, ctx).purchaseDate).toBe(
      "future_date",
    );
    expect(validateRegistrationRow({ ...valid, serial: "243500118" }, ctx).serial).toBe(
      "duplicate_in_file",
    );
    expect(validateRegistrationRow({ ...valid, customerName: " " }, ctx).customerName).toBe(
      "required",
    );
  });

  it("sends only a lone duplicate serial to admin review", () => {
    expect(needsAdminReview({ serial: "duplicate_serial" })).toBe(true);
    expect(needsAdminReview({ serial: "duplicate_serial", purchaseDate: "required" })).toBe(false);
    expect(needsAdminReview({ modelCode: "unknown_model" })).toBe(false);
  });
});

describe("model serials", () => {
  const format = modelFormat({
    serialPattern: DEFAULT_SERIAL_PATTERN,
    batchPattern: DEFAULT_BATCH_PATTERN,
  });

  it("prefixes a bare label number with the model code, and keeps a full serial", () => {
    expect(modelSerial("SC680", " 2514 06233 ")).toBe("SC680-251406233");
    expect(modelSerial("sc680", "sc680-251406233")).toBe("SC680-251406233");
    expect(modelSerial(undefined, "251406233")).toBe("251406233");
    expect(modelSerial("SC680", "")).toBe("");
    expect(modelSerial("SC680", "SM482V-251406233")).toBe("SM482V-251406233");
  });

  it("splits out the number and checks the whole serial against the model", () => {
    expect(serialNumberPart("JL3KH6-242704412")).toBe("242704412");
    expect(serialNumberPart("251406233")).toBe("251406233");
    expect(isModelSerial("SC680-251406233", "SC680", format)).toBe(true);
    expect(isModelSerial("SC680-2514062", "SC680", format)).toBe(false);
    expect(isModelSerial("SM482V-251406233", "SC680", format)).toBe(false);
  });
});

describe("claim transitions", () => {
  it("follows Submitted -> In review -> Approved -> Closed for the warranty desk", () => {
    expect(nextClaimStatus("SUBMITTED", "start_review", "admin")).toBe("IN_REVIEW");
    expect(nextClaimStatus("IN_REVIEW", "approve", "admin")).toBe("APPROVED");
    expect(nextClaimStatus("APPROVED", "close", "admin")).toBe("CLOSED");
  });

  it("can reject before or during review, never after approval", () => {
    expect(nextClaimStatus("SUBMITTED", "reject", "admin")).toBe("REJECTED");
    expect(nextClaimStatus("IN_REVIEW", "reject", "admin")).toBe("REJECTED");
    expect(nextClaimStatus("APPROVED", "reject", "admin")).toBeNull();
  });

  it("gives dealers, distributors and customers no decisions", () => {
    for (const role of ["dealer", "distributor", "customer"] as const) {
      expect(claimActionsFor("SUBMITTED", role)).toEqual([]);
      expect(claimActionsFor("IN_REVIEW", role)).toEqual([]);
    }
  });

  it("rejects invalid moves and ends at Closed / Rejected", () => {
    expect(nextClaimStatus("SUBMITTED", "approve", "admin")).toBeNull();
    expect(claimActionsFor("CLOSED", "admin")).toEqual([]);
    expect(claimActionsFor("REJECTED", "admin")).toEqual([]);
    expect(claimActionsFor("SUBMITTED", null)).toEqual([]);
  });

  it("counts Submitted, In review and Approved as open", () => {
    expect(
      ["SUBMITTED", "IN_REVIEW", "APPROVED", "REJECTED", "CLOSED"].filter((s) =>
        isOpenClaim(s as never),
      ),
    ).toEqual(["SUBMITTED", "IN_REVIEW", "APPROVED"]);
  });
});
