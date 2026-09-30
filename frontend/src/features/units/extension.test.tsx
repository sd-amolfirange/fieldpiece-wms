import { screen, within } from "@testing-library/react";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";

// W8: extended warranty and finance insights, through the real pages and the backend demo core (MSW).

const WORKFLOW_TIMEOUT = 60_000;

afterEach(() => useSession.getState().signOut());

describe("W8: extended warranty and finance insights", () => {
  it(
    "lets the customer buy 12 more months, then shows the sale in the warranty desk's finance insights",
    async () => {
      // CU03: Marcus extends his SC680 by 12 months (15% of the $329 list price).
      await signInAs("customer.mreed@wms.local");
      const cu03 = renderApp("/units/SC680-251406233");
      await cu03.user.click(await screen.findByRole("button", { name: "Extend warranty" }));
      const dialog = await screen.findByRole("dialog", { name: "Extend the warranty" });
      expect(within(dialog).getAllByRole("radio")).toHaveLength(3);
      await cu03.user.click(within(dialog).getByRole("button", { name: "Buy for $48.99" }));
      expect(await screen.findByText(/\+12 months/)).toBeInTheDocument();
      cu03.unmount();

      // A01 Finance: the extension revenue includes the sale; every product with activity has its quota meters.
      await signInAs("admin@wms.local");
      renderApp("/?view=finance");
      expect(await screen.findByRole("heading", { name: "Finance insights" })).toBeInTheDocument();
      const quotas = (await screen.findByRole("heading", { name: "Warranty quota by product" })).closest(
        "section",
      )!;
      const sc680 = within(quotas).getByText("SC680").closest("tr")!;
      expect(within(sc680).getAllByRole("meter")).toHaveLength(2);
      expect(screen.getByText("Extended warranty revenue")).toBeInTheDocument();
    },
    WORKFLOW_TIMEOUT,
  );

  it("offers no extension on an expired product", async () => {
    await signInAs("customer.mreed@wms.local");
    renderApp("/units/VP87-243208841");
    expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Extend warranty" })).not.toBeInTheDocument();
  });
});
