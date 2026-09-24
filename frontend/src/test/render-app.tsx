import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "@/app/router";
import { TooltipProvider } from "@/components/ui";
import { i18n } from "@/lib/i18n";
import { queryClient } from "@/lib/query-client";

/** Renders the whole app (real routes and guards) at `path`, against the mocked demo API. */
export function renderApp(path: string) {
  queryClient.clear();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return {
    user: userEvent.setup(),
    router,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>,
    ),
  };
}
