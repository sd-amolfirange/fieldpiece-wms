import { allowedRmaActions, checkRmaTransition, isRmaStatus } from "../rma-state-machine";

describe("RMA state machine", () => {
  it("follows the lifecycle", () => {
    expect(checkRmaTransition("shipInbound", "ISSUED", ["technician"])).toEqual({
      ok: true,
      to: "IN_TRANSIT",
    });
    expect(checkRmaTransition("receive", "IN_TRANSIT", ["service_center"])).toEqual({
      ok: true,
      to: "RECEIVED",
    });
    expect(checkRmaTransition("inspect", "RECEIVED", ["service_center"])).toEqual({
      ok: true,
      to: "INSPECTED",
    });
    expect(checkRmaTransition("complete", "INSPECTED", ["service_center"])).toEqual({
      ok: true,
      to: "COMPLETED",
    });
  });

  it("allows completing without a separate inspection step", () => {
    expect(checkRmaTransition("complete", "RECEIVED", ["claims_agent"])).toEqual({
      ok: true,
      to: "COMPLETED",
    });
  });

  it("only cancels before the unit arrives", () => {
    expect(checkRmaTransition("cancel", "IN_TRANSIT", ["claims_agent"])).toEqual({
      ok: true,
      to: "CANCELLED",
    });
    expect(checkRmaTransition("cancel", "RECEIVED", ["claims_agent"])).toEqual({
      ok: false,
      error: "RMA_INVALID_TRANSITION",
    });
  });

  it("checks roles before status", () => {
    expect(checkRmaTransition("inspect", "ISSUED", ["technician"])).toEqual({
      ok: false,
      error: "FORBIDDEN",
    });
  });

  it("lists allowed actions per role", () => {
    expect(allowedRmaActions("ISSUED", ["technician"])).toEqual(["shipInbound"]);
    expect(allowedRmaActions("ISSUED", ["service_center"])).toEqual(["shipInbound", "receive"]);
    expect(allowedRmaActions("RECEIVED", ["service_center"])).toEqual(["inspect", "complete"]);
    expect(allowedRmaActions("COMPLETED", ["admin"])).toEqual([]);
  });

  it("recognises statuses", () => {
    expect(isRmaStatus("ISSUED")).toBe(true);
    expect(isRmaStatus("issued")).toBe(false);
  });
});
