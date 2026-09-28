import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import CheckWarrantyPage from "./CheckWarrantyPage";

describe("CheckWarrantyPage", () => {
  it("shows the warranty result for a registered serial", async () => {
    const { user } = renderWithProviders(<CheckWarrantyPage />, { route: "/check" });
    await user.type(screen.getByLabelText(/serial number/i), "sc680-100037");
    await user.click(screen.getByRole("button", { name: "Check warranty" }));

    expect(await screen.findByRole("heading", { name: "Clamp meter" })).toBeInTheDocument();
    expect(screen.getByText("SC680-100037")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /file a claim/i })).toBeInTheDocument();
  });

  it("validates the serial before calling the API", async () => {
    const { user } = renderWithProviders(<CheckWarrantyPage />, { route: "/check" });
    await user.click(screen.getByRole("button", { name: "Check warranty" }));
    expect(await screen.findByText("Enter the serial number.")).toBeInTheDocument();
    expect(screen.getByLabelText(/serial number/i)).toHaveAttribute("aria-invalid", "true");
  });

  it("explains how to fix an unknown serial", async () => {
    const { user } = renderWithProviders(<CheckWarrantyPage />, { route: "/check" });
    await user.type(screen.getByLabelText(/serial number/i), "ZZZ-999999");
    await user.click(screen.getByRole("button", { name: "Check warranty" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/check the label on the back of the product/i);
  });

  it("shows a friendly message when rate-limited", async () => {
    const { user } = renderWithProviders(<CheckWarrantyPage />, { route: "/check" });
    await user.type(screen.getByLabelText(/serial number/i), "RATELIMIT");
    await user.click(screen.getByRole("button", { name: "Check warranty" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a minute/i);
  });
});
