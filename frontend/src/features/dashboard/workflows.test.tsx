import { screen, within } from "@testing-library/react";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";

// W7 (distributor oversight) through the real pages and the backend demo core (MSW).

const WORKFLOW_TIMEOUT = 30_000;

afterEach(() => useSession.getState().signOut());

describe("W7: distributor oversight", () => {
  it(
    "shows NorthStar's two dealers to the admin, totals and a comparison to the distributor, and filters by dealer",
    async () => {
      // A11: NorthStar with its two dealers.
      await signInAs("admin@demo.wms");
      const a11 = renderApp("/admin/dealers");
      const northStar = (await screen.findByRole("heading", { name: "NorthStar Distribution" })).closest(
        "section",
      )!;
      expect(within(northStar).getAllByRole("listitem")).toHaveLength(2);
      a11.unmount();

      // DL01: totals for both dealers, plus the dealer comparison.
      await signInAs("dist.northstar@demo.wms");
      const dl01 = renderApp("/");
      const comparison = (await screen.findByRole("heading", { name: "Dealer comparison" })).closest(
        "section",
      )!;
      const rows = within(comparison).getAllByRole("row").slice(1);
      expect(rows.map((r) => r.firstElementChild?.textContent)).toEqual(["CoolAir Traders", "Breeze Point"]);
      const total = await screen.findByRole("link", { name: /^Registrations this month: \d+/ });
      const perDealer = rows.map((r) => Number(r.children[1]?.textContent));
      expect(total.getAttribute("aria-label")).toContain(`: ${perDealer[0]! + perDealer[1]!}.`);

      // Filter by dealer: the numbers narrow to Breeze Point.
      await dl01.user.selectOptions(screen.getByLabelText("Show"), "Breeze Point");
      expect(
        await screen.findByRole("link", { name: `Registrations this month: ${perDealer[1]}. Open the list` }),
      ).toBeInTheDocument();
      dl01.unmount();

      // DL04: My sold units filtered to Breeze Point.
      const dl04 = renderApp("/units?dealerId=d-breeze");
      const table = await screen.findByRole("table");
      const dealerCells = await within(table).findAllByText(/^(Breeze Point|CoolAir Traders)$/);
      expect(dealerCells.length).toBeGreaterThan(0);
      expect(dealerCells.every((c) => c.textContent === "Breeze Point")).toBe(true);
      dl04.unmount();
    },
    WORKFLOW_TIMEOUT,
  );
});
