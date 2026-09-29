import { screen, within } from "@testing-library/react";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";

// W7 (distributor oversight) through the real pages and the backend demo core (MSW).

const WORKFLOW_TIMEOUT = 60_000;

afterEach(() => useSession.getState().signOut());

describe("W7: distributor oversight", () => {
  it(
    "shows Gulf States' two dealers to the admin, totals and a comparison to the distributor, and filters by dealer",
    async () => {
      // A11: Gulf States with its two dealers.
      await signInAs("admin@wms.local");
      const a11 = renderApp("/admin/dealers");
      const gulfStates = (
        await screen.findByRole("heading", { name: "Gulf States HVAC Distribution" })
      ).closest("section")!;
      expect(within(gulfStates).getAllByRole("listitem")).toHaveLength(2);
      a11.unmount();

      // DL01: totals for both dealers, plus the dealer comparison.
      await signInAs("dist.gulfstates@wms.local");
      const dl01 = renderApp("/");
      const comparison = (await screen.findByRole("heading", { name: "Dealer comparison" })).closest(
        "section",
      )!;
      const rows = within(comparison).getAllByRole("row").slice(1);
      expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual([
        "Lone Star Refrigeration Supply",
        "Bayou Air Parts",
      ]);
      const total = await screen.findByRole("link", { name: /^Registrations this month: \d+/ });
      const perDealer = rows.map((r) => Number(r.children[1]?.textContent));
      expect(total.getAttribute("aria-label")).toContain(`: ${perDealer[0]! + perDealer[1]!}.`);

      // Filter by dealer: the numbers narrow to Bayou Air Parts.
      await dl01.user.selectOptions(screen.getByLabelText("Show"), "Bayou Air Parts");
      expect(
        await screen.findByRole("link", { name: `Registrations this month: ${perDealer[1]}. Open the list` }),
      ).toBeInTheDocument();
      dl01.unmount();

      // DL04: Sold products filtered to Bayou Air Parts.
      const dl04 = renderApp("/units?dealerId=d-bayou");
      const table = await screen.findByRole("table");
      const dealerCells = await within(table).findAllByText(
        /^(Bayou Air Parts|Lone Star Refrigeration Supply)$/,
      );
      expect(dealerCells.length).toBeGreaterThan(0);
      expect(dealerCells.every((c) => c.textContent === "Bayou Air Parts")).toBe(true);
      dl04.unmount();
    },
    WORKFLOW_TIMEOUT,
  );
});
