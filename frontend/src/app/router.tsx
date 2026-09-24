import { lazy } from "react";
import { createBrowserRouter, type RouteObject } from "react-router-dom";
import type { Role } from "@/types";
import { AppLayout } from "./AppLayout";
import { RequireRole } from "./RequireRole";
import { RootLayout } from "./RootLayout";
import { RouteError } from "./RouteError";

// Route table (Section 6.2). Keep in sync with components/layout/nav-items.ts.
// Pages are lazy-loaded so each feature ships in its own chunk.

const LoginPage = lazy(() => import("@/features/auth/pages/LoginPage"));
const ForgotPasswordPage = lazy(() => import("@/features/auth/pages/ForgotPasswordPage"));
const CheckWarrantyPage = lazy(() => import("@/features/warranty-lookup/pages/CheckWarrantyPage"));
const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const RegistrationsListPage = lazy(() => import("@/features/registrations/pages/RegistrationsListPage"));
const NewRegistrationPage = lazy(() => import("@/features/registrations/pages/NewRegistrationPage"));
const BulkRegistrationPage = lazy(() => import("@/features/registrations/pages/BulkRegistrationPage"));
const ClaimsListPage = lazy(() => import("@/features/claims/pages/ClaimsListPage"));
const NewClaimPage = lazy(() => import("@/features/claims/pages/NewClaimPage"));
const ClaimDetailPage = lazy(() => import("@/features/claims/pages/ClaimDetailPage"));
const RmaListPage = lazy(() => import("@/features/rma/pages/RmaListPage"));
const RmaDetailPage = lazy(() => import("@/features/rma/pages/RmaDetailPage"));
const CustomersListPage = lazy(() => import("@/features/customers/pages/CustomersListPage"));
const CustomerDetailPage = lazy(() => import("@/features/customers/pages/CustomerDetailPage"));
const ProductsPage = lazy(() => import("@/features/products/pages/ProductsPage"));
const ProductDetailPage = lazy(() => import("@/features/products/pages/ProductDetailPage"));
const ReportsPage = lazy(() => import("@/features/reports/pages/ReportsPage"));
const AdminUsersPage = lazy(() => import("@/features/admin/pages/AdminUsersPage"));
const AdminPoliciesPage = lazy(() => import("@/features/admin/pages/AdminPoliciesPage"));
const AdminSettingsPage = lazy(() => import("@/features/admin/pages/AdminSettingsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const guarded = (roles: readonly Role[] | undefined, children: RouteObject[]): RouteObject => ({
  element: <RequireRole roles={roles} />,
  children,
});

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      // Public
      { path: "/login", element: <LoginPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/check", element: <CheckWarrantyPage /> },

      // Authenticated
      guarded(undefined, [
        {
          element: <AppLayout />,
          errorElement: <RouteError />,
          children: [
            { index: true, element: <DashboardPage /> },
            { path: "claims", element: <ClaimsListPage /> },
            { path: "claims/new", element: <NewClaimPage /> },
            { path: "claims/:id", element: <ClaimDetailPage /> },
            { path: "products", element: <ProductsPage /> },
            { path: "products/:sku", element: <ProductDetailPage /> },

            guarded(
              ["technician", "distributor", "admin"],
              [
                { path: "registrations", element: <RegistrationsListPage /> },
                { path: "registrations/new", element: <NewRegistrationPage /> },
              ],
            ),
            guarded(
              ["distributor", "admin"],
              [{ path: "registrations/bulk", element: <BulkRegistrationPage /> }],
            ),
            guarded(
              ["claims_agent", "service_center", "admin"],
              [
                { path: "rma", element: <RmaListPage /> },
                { path: "rma/:id", element: <RmaDetailPage /> },
              ],
            ),
            guarded(
              ["distributor", "claims_agent", "admin"],
              [
                { path: "customers", element: <CustomersListPage /> },
                { path: "customers/:id", element: <CustomerDetailPage /> },
              ],
            ),
            guarded(["claims_agent", "admin"], [{ path: "reports", element: <ReportsPage /> }]),
            guarded(
              ["admin"],
              [
                { path: "admin/users", element: <AdminUsersPage /> },
                { path: "admin/policies", element: <AdminPoliciesPage /> },
                { path: "admin/settings", element: <AdminSettingsPage /> },
              ],
            ),
            { path: "*", element: <NotFoundPage /> },
          ],
        },
      ]),
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
