import { useEffect, useRef } from "react";
import { env } from "@/lib/env";
import { tokenStore } from "@/lib/http";
import { useSession } from "@/lib/session";

// Loads the Warranty Assistant chat widget (../chatbot) on every page. The widget draws and styles itself (scoped
// under .fpw-), so no portal component changes. It gets the signed-in user's access token from the in-memory token
// store on each message, so warranty look-ups see exactly what the portal would show that user; on public pages it
// answers from the knowledge base only. Signing in, out or as someone else starts a fresh conversation.

// Name of the global the widget calls for the token (its data-token-provider attribute).
const TOKEN_PROVIDER = "fieldpieceAssistantToken";
export const ASSISTANT_RESET_EVENT = "fieldpiece-assistant:reset";

declare global {
  interface Window {
    fieldpieceAssistantToken?: () => string | null;
  }
}

export function AssistantWidget() {
  const userId = useSession((s) => s.user?.id ?? null);
  const previousUser = useRef(userId);

  useEffect(() => {
    if (!env.assistantEnabled) return;
    window.fieldpieceAssistantToken = () => tokenStore.get();
    const script = document.createElement("script");
    script.src = `${env.assistantUrl}/widget.js`;
    script.dataset.api = env.assistantUrl;
    script.dataset.tokenProvider = TOKEN_PROVIDER;
    script.defer = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
      delete window.fieldpieceAssistantToken;
    };
  }, []);

  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    window.dispatchEvent(new Event(ASSISTANT_RESET_EVENT));
  }, [userId]);

  return null;
}
