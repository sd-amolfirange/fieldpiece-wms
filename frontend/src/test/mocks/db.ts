import { createSeed, createSessionStore, type DemoDb, type DemoFileData } from "@demo-core";
import { env } from "@/lib/env";

// TEST-ONLY in-memory database for MSW. It runs the mock API core (backend/demo-server/src/core) through the
// `@demo-core` alias, which only Vitest resolves, so none of it can reach the app bundle.

/** API path prefix the app calls, e.g. "/api". */
export const basePath = new URL(env.apiBaseUrl, "http://localhost").pathname.replace(/\/$/, "");

/** Uploaded file contents by attachment id. */
export const mockFiles = new Map<string, DemoFileData>();

export const mockDb: DemoDb = {
  state: createSeed(),
  files: {
    save: (attachment, data) => void mockFiles.set(attachment.id, data),
    load: (id) => mockFiles.get(id),
  },
  fileUrl: (id) => `${basePath}/files/${encodeURIComponent(id)}`,
  // Email intake is a webhook for the mail provider; tests that call it send this secret.
  inboundEmailSecret: "test-inbound-secret-0123456789",
};
export const mockSessions = createSessionStore();

export function resetMockDb(today?: string) {
  mockDb.state = createSeed(today);
  mockDb.today = today ? () => today : undefined;
  mockFiles.clear();
}
