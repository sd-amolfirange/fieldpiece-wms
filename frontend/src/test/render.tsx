import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { TooltipProvider } from "@/components/ui";
import { i18n } from "@/lib/i18n";
import { createQueryClient } from "@/lib/query-client";

interface Options extends Omit<RenderOptions, "wrapper"> {
  route?: string;
  path?: string;
}

/** Renders with a fresh QueryClient, i18n and a memory router. */
export function renderWithProviders(ui: ReactElement, { route = "/", path = "*", ...options }: Options = {}) {
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const router = createMemoryRouter([{ path, element: ui }], { initialEntries: [route] });

  return {
    user: userEvent.setup(),
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <TooltipProvider>
            <RouterProvider router={router} />
          </TooltipProvider>
        </I18nextProvider>
      </QueryClientProvider>,
      options,
    ),
  };
}
