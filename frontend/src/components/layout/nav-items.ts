import {
  Boxes,
  ClipboardList,
  LayoutDashboard,
  Network,
  Package,
  Settings,
  ShieldCheck,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { Role } from "@/types";

// Menus per role (docs/implementation-plan.md, section 5). Keep in sync with app/router.tsx.

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: readonly Role[] | "all";
  end?: boolean;
}

export const navItems: NavItem[] = [
  // Admin (warranty desk)
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, roles: ["admin"], end: true },
  { to: "/registrations", labelKey: "nav.registrations", icon: ShieldCheck, roles: ["admin"], end: true },
  { to: "/units", labelKey: "nav.units", icon: Boxes, roles: ["admin"] },
  { to: "/claims", labelKey: "nav.claims", icon: ClipboardList, roles: ["admin"] },
  { to: "/models", labelKey: "nav.models", icon: Package, roles: ["admin"] },
  { to: "/registrations/channels", labelKey: "nav.channels", icon: Network, roles: ["admin"] },
  { to: "/admin/dealers", labelKey: "nav.admin", icon: Settings, roles: ["admin"] },
  // Dealer and distributor
  { to: "/", labelKey: "nav.home", icon: LayoutDashboard, roles: ["dealer", "distributor"], end: true },
  {
    to: "/registrations/new",
    labelKey: "nav.registerUnit",
    icon: ShieldCheck,
    roles: ["dealer", "distributor"],
  },
  {
    to: "/registrations/bulk",
    labelKey: "nav.bulkImport",
    icon: Upload,
    roles: ["dealer", "distributor"],
  },
  { to: "/units", labelKey: "nav.mySoldUnits", icon: Boxes, roles: ["dealer", "distributor"] },
  { to: "/claims", labelKey: "nav.claims", icon: ClipboardList, roles: ["dealer", "distributor"] },
  {
    to: "/registrations/channels",
    labelKey: "nav.channels",
    icon: Network,
    roles: ["dealer", "distributor"],
  },
  // Customer
  { to: "/", labelKey: "nav.myUnits", icon: Boxes, roles: ["customer"], end: true },
  { to: "/register", labelKey: "nav.registerProduct", icon: ShieldCheck, roles: ["customer"] },
  { to: "/claims", labelKey: "nav.myClaims", icon: ClipboardList, roles: ["customer"] },
];

/** The public warranty check is out of scope: kept here but not routed. */
export const publicNavItems: NavItem[] = [
  { to: "/check", labelKey: "nav.checkWarranty", icon: Boxes, roles: "all" },
];

export function navItemsFor(role: Role | undefined): NavItem[] {
  if (!role) return [];
  return navItems.filter((item) => item.roles === "all" || item.roles.includes(role));
}
