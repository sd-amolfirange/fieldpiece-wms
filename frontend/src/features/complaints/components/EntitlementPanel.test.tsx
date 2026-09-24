import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { EntitlementPanel } from "./EntitlementPanel";

describe("EntitlementPanel", () => {
  it("shows covered parts and chargeable labour for an old unit with a long compressor warranty", () => {
    renderWithProviders(
      <EntitlementPanel
        entitlement={{
          parts: "COVERED",
          labour: "CHARGEABLE",
          coveredPartTypes: ["COMPRESSOR"],
          claimable: true,
          reason: "PARTIAL",
        }}
      />,
    );
    expect(screen.getByText("Covered: Compressor.")).toBeInTheDocument();
    expect(screen.getByText("Labour is chargeable.")).toBeInTheDocument();
    expect(screen.getByText(/claimed back from the manufacturer/)).toBeInTheDocument();
  });

  it("says a void unit is chargeable and never claimed", () => {
    renderWithProviders(
      <EntitlementPanel
        entitlement={{
          parts: "CHARGEABLE",
          labour: "CHARGEABLE",
          coveredPartTypes: [],
          claimable: false,
          reason: "VOID",
        }}
      />,
    );
    expect(screen.getByText(/warranty on this unit is void/)).toBeInTheDocument();
    expect(screen.getByText("Nothing to claim from the manufacturer for this job.")).toBeInTheDocument();
  });
});
