import type { QueryClient } from "@tanstack/react-query";

/**
 * A workflow action (send to service, job result, claim decision, reset…) changes complaints, claims, units,
 * the dashboard, notifications and the integration log at once, so refetch everything that's on screen.
 */
export const refreshEverything = (qc: QueryClient) => qc.invalidateQueries();
