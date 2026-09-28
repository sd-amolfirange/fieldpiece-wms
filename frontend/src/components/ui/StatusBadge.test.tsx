import { render, screen } from "@testing-library/react";
import { ClaimStatusBadge, WarrantyStatusBadge } from "./StatusBadge";

describe("status badges", () => {
  it("always shows a text label, not just colour", () => {
    render(<ClaimStatusBadge status="REJECTED" />);
    const badge = screen.getByText("Rejected");
    expect(badge.className).toContain("bg-danger-bg");
    expect(badge.className).toContain("text-danger");
  });

  it("strikes through VOID warranties", () => {
    render(<WarrantyStatusBadge status="VOID" />);
    expect(screen.getByText("Void").className).toContain("line-through");
  });
});
