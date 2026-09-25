import type { ClaimStatus } from "@prisma/client";
import { allowedActions, checkTransition, TRANSITIONS, type ClaimAction } from "../claim-state-machine";

describe("claim state machine", () => {
  it("walks the happy path from draft to closed", () => {
    const steps: [ClaimAction, ClaimStatus, ClaimStatus, Parameters<typeof checkTransition>[3]?][] = [
      ["submit", "DRAFT", "SUBMITTED"],
      ["startReview", "SUBMITTED", "IN_REVIEW"],
      ["approve", "IN_REVIEW", "APPROVED", { resolution: "repair" }],
      ["shipInbound", "RMA_ISSUED", "IN_TRANSIT"],
      ["receive", "IN_TRANSIT", "RECEIVED"],
      ["complete", "RECEIVED", "REPAIRED", { rmaType: "repair" }],
      ["close", "REPAIRED", "CLOSED"],
    ];
    for (const [action, from, to, input] of steps) {
      expect(checkTransition(action, from, ["admin"], input)).toEqual({ ok: true, to });
    }
  });

  it("issues the RMA only as the system", () => {
    expect(checkTransition("issueRma", "APPROVED", ["system"])).toEqual({ ok: true, to: "RMA_ISSUED" });
    expect(checkTransition("issueRma", "APPROVED", ["admin"])).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("loops NEEDS_INFO back to IN_REVIEW when the customer responds", () => {
    expect(
      checkTransition("requestInfo", "IN_REVIEW", ["claims_agent"], { message: "Send a photo" }),
    ).toEqual({
      ok: true,
      to: "NEEDS_INFO",
    });
    expect(checkTransition("respond", "NEEDS_INFO", ["technician"])).toEqual({ ok: true, to: "IN_REVIEW" });
  });

  it("maps complete to the RMA resolution", () => {
    expect(checkTransition("complete", "RECEIVED", ["service_center"], { rmaType: "replace" })).toEqual({
      ok: true,
      to: "REPLACED",
    });
    expect(checkTransition("complete", "RECEIVED", ["service_center"], { rmaType: "credit" })).toEqual({
      ok: true,
      to: "CREDITED",
    });
    expect(checkTransition("complete", "RECEIVED", ["service_center"])).toEqual({
      ok: false,
      error: "RESOLUTION_REQUIRED",
    });
  });

  it("lets a service center receive straight from RMA_ISSUED (unit arrived without tracking)", () => {
    expect(checkTransition("receive", "RMA_ISSUED", ["service_center"])).toEqual({
      ok: true,
      to: "RECEIVED",
    });
  });

  describe("error ordering: role, then status, then input", () => {
    it("reports FORBIDDEN before an invalid status", () => {
      expect(checkTransition("approve", "DRAFT", ["technician"])).toEqual({ ok: false, error: "FORBIDDEN" });
    });

    it("reports an invalid transition before missing input", () => {
      expect(checkTransition("approve", "REJECTED", ["claims_agent"])).toEqual({
        ok: false,
        error: "CLAIM_INVALID_TRANSITION",
      });
    });

    it.each<[ClaimAction, string]>([
      ["requestInfo", "MESSAGE_REQUIRED"],
      ["approve", "RESOLUTION_REQUIRED"],
      ["reject", "REASON_REQUIRED"],
    ])("%s requires input (%s)", (action, error) => {
      expect(checkTransition(action, "IN_REVIEW", ["claims_agent"], {})).toEqual({ ok: false, error });
      expect(
        checkTransition(action, "IN_REVIEW", ["claims_agent"], { message: "  ", reason: " " }),
      ).toMatchObject({
        ok: false,
      });
    });
  });

  it("never allows anything out of CLOSED", () => {
    for (const action of Object.keys(TRANSITIONS) as ClaimAction[]) {
      expect(
        checkTransition(action, "CLOSED", ["admin", "system"], { resolution: "repair", rmaType: "repair" }),
      ).toMatchObject({ ok: false });
    }
  });
});

describe("allowedActions", () => {
  it("gives technicians submit and respond only", () => {
    expect(allowedActions("DRAFT", ["technician"])).toEqual(["submit"]);
    expect(allowedActions("NEEDS_INFO", ["technician"])).toEqual(["respond"]);
    expect(allowedActions("IN_REVIEW", ["technician"])).toEqual([]);
  });

  it("gives agents the review decisions", () => {
    expect(allowedActions("SUBMITTED", ["claims_agent"])).toEqual(["startReview"]);
    expect(allowedActions("IN_REVIEW", ["claims_agent"])).toEqual(["requestInfo", "approve", "reject"]);
    expect(allowedActions("REJECTED", ["claims_agent"])).toEqual(["close"]);
  });

  it("does not expose RMA-driven or system actions", () => {
    expect(allowedActions("RMA_ISSUED", ["admin"])).toEqual([]);
    expect(allowedActions("APPROVED", ["admin"])).toEqual([]);
  });

  it("does not let admins respond on a customer's behalf", () => {
    expect(allowedActions("NEEDS_INFO", ["admin"])).toEqual([]);
  });

  it("merges multiple roles", () => {
    expect(allowedActions("NEEDS_INFO", ["claims_agent", "distributor"])).toEqual(["respond"]);
  });
});
