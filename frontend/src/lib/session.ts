import { create } from "zustand";
import type { SessionUser } from "@/types";
import { clearAllDrafts } from "./drafts";
import { setAuthFailureHandler, tokenStore } from "./http";
import { queryClient } from "./query-client";

// Client auth session (Zustand, Section 2.1). Not persisted: on reload the app restores
// the session through the httpOnly refresh cookie (see features/auth).

type SessionStatus = "unknown" | "authenticated" | "anonymous";

interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  signIn: (user: SessionUser, accessToken: string) => void;
  signOut: () => void;
  markAnonymous: () => void;
}

export const useSession = create<SessionState>((set) => ({
  status: "unknown",
  user: null,
  signIn: (user, accessToken) => {
    tokenStore.set(accessToken);
    set({ status: "authenticated", user });
  },
  signOut: () => {
    tokenStore.clear();
    queryClient.clear();
    clearAllDrafts();
    set({ status: "anonymous", user: null });
  },
  markAnonymous: () => set({ status: "anonymous", user: null }),
}));

setAuthFailureHandler(() => useSession.getState().signOut());

export const useCurrentUser = () => useSession((s) => s.user);
export const useCurrentRole = () => useSession((s) => s.user?.role);
