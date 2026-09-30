import { screen, within } from "@testing-library/react";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";

// A01 "Fieldpiece apps" and A04 "Registered via": warranties registered from Overwatch and Job Link.

afterEach(() => useSession.getState().signOut());

describe("Fieldpiece apps", () => {
  it("summarises each app's warranties on the admin dashboard", async () => {
    await signInAs("admin@wms.local");
    renderApp("/");
    // Level 3: the dashboard card (the sidebar also has a "Fieldpiece apps" heading, level 2).
    const card = (await screen.findByRole("heading", { name: "Fieldpiece apps", level: 3 })).closest(
      "section",
    )!;
    for (const app of ["Overwatch", "Job Link"]) {
      const panel = within(card).getByRole("article", { name: app });
      expect(within(panel).getByText("registered products")).toBeInTheDocument();
      expect(within(panel).getByRole("link", { name: `View ${app} products` })).toHaveAttribute(
        "href",
        `/units?channel=${app === "Job Link" ? "JOBLINK" : "OVERWATCH"}`,
      );
    }
  });

  it("filters registered products by the app they were registered from", async () => {
    await signInAs("admin@wms.local");
    renderApp("/units?channel=JOBLINK");
    expect(await screen.findByLabelText("Registered via")).toHaveValue("JOBLINK");
    // Wait for the products (not the loading placeholders): each row links to its product.
    await screen.findAllByRole("link", { name: /^[A-Z0-9]+-\d{9}$/ });
    const rows = screen.getAllByRole("row").filter((r) => within(r).queryByRole("link"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(within(row).getByText("Job Link")).toBeInTheDocument();
  });
});
