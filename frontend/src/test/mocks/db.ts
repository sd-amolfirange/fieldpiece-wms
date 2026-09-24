import { createSeed, createSessionStore, type DemoDb } from "@demo-core";

// TEST-ONLY in-memory demo database for MSW. It runs the backend's demo core (backend/demo-server/src/core)
// through the `@demo-core` alias, which only Vitest resolves, so none of it can reach the app bundle.

export const mockDb: DemoDb = { state: createSeed() };
export const mockSessions = createSessionStore();
/** Uploaded file contents by attachment id. */
export const mockFiles = new Map<string, Blob>();

export function resetMockDb(today?: string) {
  mockDb.state = createSeed(today);
  mockDb.today = today ? () => today : undefined;
  mockFiles.clear();
}
