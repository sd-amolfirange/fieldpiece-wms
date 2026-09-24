import { createSeed, createSessionStore, type DemoDb } from "@/demo-core";

// In-memory demo database for MSW (unit tests and `npm run dev:mock`). The real demo runs on demo-server/.

export const mockDb: DemoDb = { state: createSeed() };
export const mockSessions = createSessionStore();
/** Uploaded file contents by attachment id. */
export const mockFiles = new Map<string, Blob>();

export function resetMockDb(today?: string) {
  mockDb.state = createSeed(today);
  mockDb.today = today ? () => today : undefined;
  mockFiles.clear();
}
