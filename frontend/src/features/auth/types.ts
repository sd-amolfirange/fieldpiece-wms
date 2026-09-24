import type { SessionUser } from "@/types";

export interface AuthResponse {
  accessToken: string;
  user: SessionUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/** A demo account offered on the sign-in page. The demo server supplies the list (GET /auth/demo-accounts),
 * so no account details or passwords are compiled into the app. */
export interface DemoAccount {
  email: string;
  label: string;
  password: string;
}
