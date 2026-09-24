import { lazy } from "react";
import { useCurrentRole } from "@/lib/session";

// "/" per role: A01 admin dashboard, DL01 dealer / distributor home, CU02 My units for customers.

const DashboardPage = lazy(() => import("@/features/dashboard/pages/DashboardPage"));
const MyUnitsPage = lazy(() => import("@/features/units/pages/MyUnitsPage"));

export default function HomePage() {
  return useCurrentRole() === "customer" ? <MyUnitsPage /> : <DashboardPage />;
}
