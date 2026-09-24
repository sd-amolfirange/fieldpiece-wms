import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api-error";

const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 409, 422, 429]);

/** The demo runs in several windows on one server: live views poll so each window sees the others' changes. */
export const LIVE_REFRESH_MS = 5_000;

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: LIVE_REFRESH_MS,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && NO_RETRY_STATUSES.has(error.status)) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createQueryClient();
