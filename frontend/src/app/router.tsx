import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import type { Role } from "@/types";
import { AppLayout } from "./AppLayout";
import { RequireRole } from "./RequireRole";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";

// Route table for the demo (docs/implementation-plan.md, section 2). Keep in sync with
// components/layout/nav-items.ts.
// The out-of-scope screens (customers, reports, policies, settings, public check) keep their code
// but are not routed.

const LoginPage = lazy(() => import("@/features/auth/pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/pages/ForgotPasswordPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const RegistrationsListPage = lazy(() => import("@/features/registrations/pages/RegistrationsListPage"));
const RegistrationReviewPage = lazy(() => import("@/features/registrations/pages/RegistrationReviewPage"));
const NewRegistrationPage = lazy(() => import("@/features/registrations/pages/NewRegistrationPage"));
const BulkRegistrationPage = lazy(() => import("@/features/registrations/pages/BulkRegistrationPage"));
const CustomerRegisterPage = lazy(() => import("@/features/registrations/pages/CustomerRegisterPage"));
const RegistrationHubPage = lazy(() => import("@/features/registrations/pages/RegistrationHubPage"));
const PublicRegisterPage = lazy(() => import("@/features/registrations/pages/PublicRegisterPage"));
const UnitsListPage = lazy(() => import("@/features/units/pages/UnitsListPage"));
const UnitDetailPage = lazy(() => import("@/features/units/pages/UnitDetailPage"));
const ModelsPage = lazy(() => import("@/features/products/pages/ProductsPage"));
const ModelDetailPage = lazy(() => import("@/features/products/pages/ProductDetailPage"));
const ClaimsListPage = lazy(() => import("@/features/claims/pages/ClaimsListPage"));
const NewClaimPage = lazy(() => import("@/features/claims/pages/NewClaimPage"));
const ClaimDetailPage = lazy(() => import("@/features/claims/pages/ClaimDetailPage"));
const DealersUsersPage = lazy(() => import("@/features/admin/pages/DealersUsersPage"));
const IntegrationLogPage = lazy(() => import("@/features/admin/pages/IntegrationLogPage"));
const SimulatePage = lazy(() => import("@/features/admin/pages/SimulatePage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const guarded = (roles: readonly Role[] | undefined, children: RouteObject[]): RouteObject => ({
  element: <RequireRole roles={roles} />,
  children,
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
      // Product registration form for the website (no account needed)
      { path: "/register-product", element: <PublicRegisterPage /> },

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
                { path: "admin/dealers", element: <DealersUsersPage /> }, // A11
                { path: "admin/integrations", element: <IntegrationLogPage /> }, // A12
                { path: "admin/simulate", element: <SimulatePage /> }, // A13
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
            // Registration channels: a dealer/distributor reference page (mailbox address, web form link, bulk
            // template). Not for admin — partner API key management lives on Admin > Integrations instead.
            guarded(PARTNERS, [{ path: "registrations/channels", element: <RegistrationHubPage /> }]),
            guarded(["customer"], [{ path: "register", element: <CustomerRegisterPage /> }]), // CU01

            // Shared screens: the demo server decides which rows each role gets.
            { path: "units/:serial", element: <UnitDetailPage /> }, // A05 / DL05 / CU03
            { path: "claims", element: <ClaimsListPage /> }, // A09 / DL07 / My claims
            { path: "claims/new", element: <NewClaimPage /> }, // CU04 / DL06 (admin: on a customer's behalf)
            { path: "claims/:id", element: <ClaimDetailPage /> }, // A10 / DL07 / CU05

            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ]),
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
