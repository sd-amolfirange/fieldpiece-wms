import type { ClaimStatus, Role } from "@/types";
import {
  allowedTransitions,
  canPerform,
  CLAIM_TRANSITIONS,
  isOpen,
  isTerminal,
  nextStatus,
  transitionsFrom,
} from "./transitions";

const ALL_STATUSES: ClaimStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "NEEDS_INFO",
  "APPROVED",
  "REJECTED",
  "RMA_ISSUED",
  "IN_TRANSIT",
  "RECEIVED",
  "REPAIRED",
  "REPLACED",
  "CREDITED",
  "CLOSED",
];

const actionsFor = (status: ClaimStatus, role: Role) => allowedTransitions(status, role).map((t) => t.action);

describe("claim state machine", () => {
  it("follows the happy path from draft to closed", () => {
    const path: [ClaimStatus, Parameters<typeof nextStatus>[1], ClaimStatus][] = [
      ["DRAFT", "submit", "SUBMITTED"],
      ["SUBMITTED", "start_review", "IN_REVIEW"],
      ["IN_REVIEW", "approve", "APPROVED"],
      ["APPROVED", "issue_rma", "RMA_ISSUED"],
      ["RMA_ISSUED", "mark_in_transit", "IN_TRANSIT"],
      ["IN_TRANSIT", "mark_received", "RECEIVED"],
      ["RECEIVED", "mark_repaired", "REPAIRED"],
      ["REPAIRED", "close", "CLOSED"],
    ];
    path.forEach(([from, action, to]) => expect(nextStatus(from, action)).toBe(to));
  });

  it("loops NEEDS_INFO back to IN_REVIEW when the customer responds", () => {
    expect(nextStatus("IN_REVIEW", "request_info")).toBe("NEEDS_INFO");
    expect(nextStatus("NEEDS_INFO", "respond")).toBe("IN_REVIEW");
  });

  it("lets rejected claims only close", () => {
    expect(nextStatus("IN_REVIEW", "reject")).toBe("REJECTED");
    expect(transitionsFrom("REJECTED").map((t) => t.action)).toEqual(["close"]);
  });

  it("returns null for an action that isn't valid from the status", () => {
    expect(nextStatus("DRAFT", "approve")).toBeNull();
    expect(nextStatus("CLOSED", "close")).toBeNull();
  });

  it("allows every resolution from RECEIVED and closes each of them", () => {
    (["REPAIRED", "REPLACED", "CREDITED"] as const).forEach((resolved) => {
      expect(transitionsFrom("RECEIVED").some((t) => t.to === resolved)).toBe(true);
      expect(nextStatus(resolved, "close")).toBe("CLOSED");
    });
  });

  it("has no transitions out of CLOSED", () => {
    expect(transitionsFrom("CLOSED")).toHaveLength(0);
    expect(isTerminal("CLOSED")).toBe(true);
    expect(isTerminal("REPAIRED")).toBe(false);
  });

  it("only ever targets known statuses", () => {
    CLAIM_TRANSITIONS.forEach((t) => {
      expect(ALL_STATUSES).toContain(t.from);
      expect(ALL_STATUSES).toContain(t.to);
    });
  });
});

describe("role permissions", () => {
  it("lets dealers submit and respond, but never review", () => {
    expect(actionsFor("DRAFT", "dealer")).toEqual(["submit"]);
    expect(actionsFor("NEEDS_INFO", "dealer")).toEqual(["respond"]);
    expect(actionsFor("IN_REVIEW", "dealer")).toEqual([]);
    expect(canPerform("IN_REVIEW", "approve", "dealer")).toBe(false);
  });

  it("gives the admin the review decisions", () => {
    expect(actionsFor("SUBMITTED", "admin")).toEqual(["start_review"]);
    expect(actionsFor("IN_REVIEW", "admin")).toEqual(["request_info", "approve", "reject"]);
  });

  it("gives the admin receiving and resolution", () => {
    expect(actionsFor("IN_TRANSIT", "admin")).toEqual(["mark_received"]);
    expect(actionsFor("RECEIVED", "admin")).toEqual(["mark_repaired", "mark_replaced", "mark_credited"]);
    expect(canPerform("IN_TRANSIT", "mark_received", "distributor")).toBe(false);
  });

  it("gives customers nothing", () => {
    CLAIM_TRANSITIONS.forEach((t) => expect(canPerform(t.from, t.action, "customer")).toBe(false));
  });

  it("lets admins do everything", () => {
    CLAIM_TRANSITIONS.forEach((t) => expect(canPerform(t.from, t.action, "admin")).toBe(true));
  });

  it("returns nothing without a role", () => {
    expect(allowedTransitions("IN_REVIEW", undefined)).toEqual([]);
    expect(canPerform("DRAFT", "submit", null)).toBe(false);
  });
});

describe("isOpen", () => {
  it.each<[ClaimStatus, boolean]>([
    ["DRAFT", false],
    ["SUBMITTED", true],
    ["IN_REVIEW", true],
    ["NEEDS_INFO", true],
    ["APPROVED", true],
    ["RMA_ISSUED", true],
    ["RECEIVED", true],
    ["REJECTED", false],
    ["REPAIRED", false],
    ["CLOSED", false],
  ])("%s -> %s", (status, open) => expect(isOpen(status)).toBe(open));
});
