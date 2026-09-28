import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
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

describe("routing and role homes", { timeout: 20_000 }, () => {
  afterEach(() => useSession.getState().signOut());

  it("shows the admin the A01 cards", async () => {
    await signInAs("admin@wms.local");
    renderAt("/");
    expect(await screen.findByText("Ending within 30 days")).toBeInTheDocument();
    expect(screen.getByText("Open claims")).toBeInTheDocument();
    expect(screen.getByText("Registrations to review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Product catalog" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registration channels" })).toBeInTheDocument();
  });

  it("shows a dealer its own home and menu, without admin items", async () => {
    await signInAs("dealer.lonestar@wms.local");
    renderAt("/");
    expect(await screen.findByText("Registrations this month")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Products I sold" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "Warranty claims" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Product catalog" })).not.toBeInTheDocument();
  });

  it("gives the customer their three products on CU02 My products", async () => {
    await signInAs("customer.mreed@wms.local");
    renderAt("/");
    expect(await screen.findByText("251406233")).toBeInTheDocument();
    expect(screen.getByText("243208841")).toBeInTheDocument();
    expect(screen.getByText("252207119")).toBeInTheDocument();
    expect(screen.getByText("Batch 2514-L01")).toBeInTheDocument();
    expect(screen.getAllByText(/^Warranty ended on /).length).toBeGreaterThan(0);
  });

  it("blocks, not just hides, other roles' screens", async () => {
    await signInAs("customer.mreed@wms.local");
    renderAt("/registrations");
    expect(await screen.findByText(/you don't have access/i)).toBeInTheDocument();
  });

  it("keeps removed and out-of-scope screens unreachable", async () => {
    await signInAs("admin@wms.local");
    renderAt("/rma");
    expect(await screen.findByText(/couldn't find that page/i)).toBeInTheDocument();
  });

  it("no longer routes the old complaint screens", async () => {
    await signInAs("admin@wms.local");
    renderAt("/complaints");
    expect(await screen.findByText(/couldn't find that page/i)).toBeInTheDocument();
  });

  it("shows the admin the distributor -> dealer hierarchy and every login on A11", async () => {
    // Replaces the placeholder-screen test: since Phase 5 every demo screen is built.
    await signInAs("admin@wms.local");
    renderAt("/admin/dealers");
    const gulfStates = (
      await screen.findByRole("heading", { name: "Gulf States HVAC Distribution" })
    ).closest("section")!;
    expect(within(gulfStates).getByText("Lone Star Refrigeration Supply")).toBeInTheDocument();
    expect(within(gulfStates).getByText("Bayou Air Parts")).toBeInTheDocument();
    expect(screen.getAllByText("dist.gulfstates@wms.local").length).toBeGreaterThan(0);
  });

  it("sends signed-out visitors to the sign-in page with the demo accounts", async () => {
    renderAt("/units");
    expect(await screen.findByRole("heading", { name: "Sign in to HVAC Warranty" })).toBeInTheDocument();
    // Loaded from the demo server, not compiled into the app.
    expect(await screen.findByRole("option", { name: "Customer: Marcus Reed" })).toBeInTheDocument();
  });

  it("serves the website registration form without signing in", async () => {
    renderAt("/register-product?serial=263899911&model=SC260");
    expect(
      await screen.findByRole("heading", { name: "Register your Fieldpiece product" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/serial number/i)).toHaveValue("263899911");
  });
});
