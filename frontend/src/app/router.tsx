import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import type { Role } from "@/types";
import { AppLayout } from "./AppLayout";
import type { ScreenCode } from "./pages/ScreenPlaceholderPage";
import { RequireRole } from "./RequireRole";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";

// Route table for the demo (docs/implementation-plan.md, section 2). Keep in sync with
// components/layout/nav-items.ts. Screens a later phase builds render ScreenPlaceholderPage.
// The out-of-scope screens (RMA, customers, reports, policies, settings, public check) keep their code
// but are not routed.

const LoginPage = lazy(() => import("@/features/auth/pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/pages/ForgotPasswordPage"));
const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const ScreenPlaceholderPage = lazy(() => import("./pages/ScreenPlaceholderPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const guarded = (roles: readonly Role[] | undefined, children: RouteObject[]): RouteObject => ({
  element: <RequireRole roles={roles} />,
  children,
});

type Screens = Partial<Record<Role, ScreenCode>>;
const screen = (path: string, screens: Screens): RouteObject => ({
  path,
  element: <ScreenPlaceholderPage screens={screens} />,
});

const PARTNERS: Role[] = ["dealer", "distributor"];

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      // Public
      { path: "/login", element: <LoginPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },

      // Authenticated
      guarded(undefined, [
        {
          element: <AppLayout />,
          errorElement: <RouteError />,
          children: [
            // A01 / DL01 / CU02 (role home)
            { index: true, element: <DashboardPage /> },

            guarded(
              ["admin"],
              [
                screen("registrations", { admin: "A02" }),
                screen("registrations/:id", { admin: "A03" }),
                screen("models", { admin: "A06" }),
                screen("models/:id", { admin: "A06" }),
                screen("claims", { admin: "A09" }),
                screen("claims/:id", { admin: "A10" }),
                screen("admin/dealers", { admin: "A11" }),
                screen("admin/integrations", { admin: "A12" }),
                screen("admin/simulate", { admin: "A13" }),
              ],
            ),
            guarded(
              ["admin", ...PARTNERS],
              [
                screen("registrations/new", { admin: "DL03", dealer: "DL03", distributor: "DL03" }),
                screen("registrations/bulk", { admin: "DL02", dealer: "DL02", distributor: "DL02" }),
                screen("units", { admin: "A04", dealer: "DL04", distributor: "DL04" }),
              ],
            ),
            guarded(["customer"], [screen("register", { customer: "CU01" })]),

            // Shared screens: the demo server decides which rows each role gets.
            screen("units/:serial", { admin: "A05", dealer: "DL05", distributor: "DL05", customer: "CU03" }),
            screen("complaints", { admin: "A07", dealer: "DL07", distributor: "DL07", customer: "CU05" }),
            screen("complaints/new", {
              admin: "DL06",
              dealer: "DL06",
              distributor: "DL06",
              customer: "CU04",
            }),
            screen("complaints/:id", { admin: "A08", dealer: "DL07", distributor: "DL07", customer: "CU05" }),

            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ]),
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
