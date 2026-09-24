import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { createSeed, type DemoState, type SessionStore } from "./core/index";

// Keeps demo state and sign-in sessions on disk, so restarting the server doesn't lose data or sign
// everyone out of the four demo windows. Plain JSON, rewritten after every change.

/**
 * Saves via a temp file. On Windows the rename can fail for a moment (EPERM / EBUSY) while another process,
 * such as a virus scanner, has the file open: retry, then write in place. The data is also in memory, so a
 * failed save is logged and never fails the request.
 */
function writeJson(path: string, value: unknown) {
  const json = JSON.stringify(value);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, json);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        renameSync(tmp, path);
        return;
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") throw e;
      }
    }
    writeFileSync(path, json);
  } catch (e) {
    console.error(`Couldn't save ${path}:`, (e as Error).message);
  }
}

const emptyCollections = (): Pick<DemoState, "bulkImports"> => ({
  bulkImports: [],
});

export function loadState(path: string): DemoState {
  if (existsSync(path)) {
    try {
      const state = JSON.parse(readFileSync(path, "utf8")) as DemoState;
      // Collections added after the file was saved start empty.
      if (state.version === 1) return { ...emptyCollections(), ...state };
    } catch {
      // unreadable file: start from the seed again
    }
  }
  const seed = createSeed();
  writeJson(path, seed);
  return seed;
}

export const saveState = (path: string, state: DemoState) =>
  writeJson(path, state);

export function createFileSessionStore(path: string): SessionStore {
  const sessions = new Map<string, string>();
  if (existsSync(path)) {
    try {
      for (const [token, userId] of Object.entries(
        JSON.parse(readFileSync(path, "utf8")) as Record<string, string>,
      )) {
        sessions.set(token, userId);
      }
    } catch {
      sessions.clear();
    }
  }
  const save = () => writeJson(path, Object.fromEntries(sessions));
  return {
    create(userId) {
      const token = `${userId}.${crypto.randomUUID()}`;
      sessions.set(token, userId);
      save();
      return token;
    },
    get: (token) => (token ? sessions.get(token) : undefined),
    delete(token) {
      if (token && sessions.delete(token)) save();
    },
  };
}
