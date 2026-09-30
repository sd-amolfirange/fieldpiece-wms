import { screen, within } from "@testing-library/react";
import { env } from "@/lib/env";
import { useSession } from "@/lib/session";
import { renderApp } from "@/test/render-app";
import { signInAs } from "@/test/sign-in";
import { appLinksFor } from "./nav-items";

// "Fieldpiece apps" in the sidebar: Overwatch and Job Link, for the warranty desk only, opening in a new tab.

afterEach(() => useSession.getState().signOut());

describe("Fieldpiece apps", () => {
  it("are for the warranty desk only", () => {
    expect(appLinksFor("admin").map((a) => [a.id, a.href])).toEqual([
      ["overwatch", env.overwatchUrl],
      ["joblink", env.jobLinkUrl],
    ]);
    for (const role of ["dealer", "distributor", "customer"] as const) expect(appLinksFor(role)).toEqual([]);
  });

  it("show in the admin's sidebar and open in a new tab", async () => {
    await signInAs("admin@wms.local");
    renderApp("/");
    const nav = (await screen.findAllByRole("navigation", { name: "Main navigation" }))[0]!;
    const apps = within(nav).getByRole("region", { name: "Fieldpiece apps" });
    for (const [name, href] of [
      ["Overwatch (opens in a new tab)", env.overwatchUrl],
      ["Job Link (opens in a new tab)", env.jobLinkUrl],
    ]) {
      const link = within(apps).getByRole("link", { name });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("don't show for a dealer", async () => {
    await signInAs("dealer.lonestar@wms.local");
    renderApp("/");
    await screen.findAllByRole("navigation", { name: "Main navigation" });
    expect(screen.queryByRole("region", { name: "Fieldpiece apps" })).not.toBeInTheDocument();
  });
});
