import type { SessionUser } from "@/types";

export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** Seed accounts from docs/Demo workflows.md, offered on the sign-in page in demo and mock mode. */
export const DEMO_ACCOUNTS = [
  { email: "admin@demo.wms", labelKey: "auth.demoAccounts.admin" },
  { email: "dealer.coolair@demo.wms", labelKey: "auth.demoAccounts.dealer" },
  { email: "dist.northstar@demo.wms", labelKey: "auth.demoAccounts.distributor" },
  { email: "customer.rk@demo.wms", labelKey: "auth.demoAccounts.customer" },
  { email: "dealer.breeze@demo.wms", labelKey: "auth.demoAccounts.breeze" },
] as const;

export const DEMO_PASSWORD = "demo";
