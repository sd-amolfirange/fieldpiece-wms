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
const HomePage = lazy(() => import("./pages/HomePage"));
const RegistrationsListPage = lazy(() => import("@/features/registrations/pages/RegistrationsListPage"));
const RegistrationReviewPage = lazy(() => import("@/features/registrations/pages/RegistrationReviewPage"));
const NewRegistrationPage = lazy(() => import("@/features/registrations/pages/NewRegistrationPage"));
const BulkRegistrationPage = lazy(() => import("@/features/registrations/pages/BulkRegistrationPage"));
const CustomerRegisterPage = lazy(() => import("@/features/registrations/pages/CustomerRegisterPage"));
const UnitsListPage = lazy(() => import("@/features/units/pages/UnitsListPage"));
const UnitDetailPage = lazy(() => import("@/features/units/pages/UnitDetailPage"));
const ModelsPage = lazy(() => import("@/features/products/pages/ProductsPage"));
const ModelDetailPage = lazy(() => import("@/features/products/pages/ProductDetailPage"));
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
            { index: true, element: <HomePage /> },

            guarded(
              ["admin"],
              [
                { path: "registrations", element: <RegistrationsListPage /> }, // A02
                { path: "registrations/:id", element: <RegistrationReviewPage /> }, // A03
                { path: "models", element: <ModelsPage /> }, // A06
                { path: "models/:id", element: <ModelDetailPage /> }, // A06
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
                { path: "registrations/new", element: <NewRegistrationPage /> }, // DL03 (admin: manual add)
                { path: "registrations/bulk", element: <BulkRegistrationPage /> }, // DL02
                { path: "units", element: <UnitsListPage /> }, // A04 / DL04
              ],
            ),
            guarded(["customer"], [{ path: "register", element: <CustomerRegisterPage /> }]), // CU01

            // Shared screens: the demo server decides which rows each role gets.
            { path: "units/:serial", element: <UnitDetailPage /> }, // A05 / DL05 / CU03
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
