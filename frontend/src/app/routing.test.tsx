import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TooltipProvider } from "@/components/ui";
import { i18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query-client";
import { useSession } from "@/lib/session";
import { signInAs } from "@/test/sign-in";
import { routes } from "./router";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe("routing and role homes", () => {
  afterEach(() => useSession.getState().signOut());

  it("shows the admin the A01 cards", async () => {
    await signInAs("admin@demo.wms");
    renderAt("/");
    expect(await screen.findByText("Expiring within 30 days")).toBeInTheDocument();
    expect(screen.getByText("Open claims")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Models & parts" })).toBeInTheDocument();
  });

  it("shows a dealer its own home and menu, without admin items", async () => {
    await signInAs("dealer.coolair@demo.wms");
    renderAt("/");
    expect(await screen.findByText("Registrations this month")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "My sold units" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Models & parts" })).not.toBeInTheDocument();
  });

  it("gives the customer their two units", async () => {
    await signInAs("customer.rk@demo.wms");
    renderAt("/");
    const tile = await screen.findByText("My units", { selector: "p" });
    expect(tile.nextElementSibling).toHaveTextContent("2");
  });

  it("blocks, not just hides, other roles' screens", async () => {
    await signInAs("customer.rk@demo.wms");
    renderAt("/registrations");
    expect(await screen.findByText(/you don't have access/i)).toBeInTheDocument();
  });

  it("keeps the out-of-scope screens unreachable", async () => {
    await signInAs("admin@demo.wms");
    renderAt("/rma");
    expect(await screen.findByText(/couldn't find that page/i)).toBeInTheDocument();
  });

  it("shows the planned screen and its must-contain list for routes a later phase builds", async () => {
    await signInAs("dealer.coolair@demo.wms");
    renderAt("/units");
    expect(await screen.findByRole("heading", { name: /DL04 · My sold units/ })).toBeInTheDocument();
    expect(screen.getByText("Search, status pills")).toBeInTheDocument();
  });

  it("sends signed-out visitors to the sign-in page with the demo accounts", async () => {
    renderAt("/units");
    expect(await screen.findByRole("heading", { name: "Sign in to HVAC Warranty" })).toBeInTheDocument();
    // Loaded from the demo server, not compiled into the app.
    expect(await screen.findByRole("option", { name: "Customer: R. Kulkarni" })).toBeInTheDocument();
  });
});
