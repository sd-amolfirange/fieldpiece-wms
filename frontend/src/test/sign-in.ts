import { http } from "@/lib/http";
import { useSession } from "@/lib/session";
import type { SessionUser } from "@/types";

/** Signs in against the mocked demo API with a seed account (password "demo"). */
export async function signInAs(email: string): Promise<SessionUser> {
  const { data } = await http.post<{ accessToken: string; user: SessionUser }>(
    "/auth/login",
    { email, password: "demo" },
    { skipAuthRefresh: true },
  );
  useSession.getState().signIn(data.user, data.accessToken);
  return data.user;
}
