import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createSeed, type DemoState, type SessionStore } from "../../frontend/src/demo-core/index";

// Keeps demo state and sign-in sessions on disk, so restarting the server doesn't lose data or sign
// everyone out of the four demo windows. Plain JSON, rewritten after every change.

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

export function loadState(path: string): DemoState {
  if (existsSync(path)) {
    try {
      const state = JSON.parse(readFileSync(path, "utf8")) as DemoState;
      if (state.version === 1) return state;
    } catch {
      // unreadable file: start from the seed again
    }
  }
  const seed = createSeed();
  writeJson(path, seed);
  return seed;
}

export const saveState = (path: string, state: DemoState) => writeJson(path, state);

export function createFileSessionStore(path: string): SessionStore {
  let sessions: Record<string, string> = {};
  if (existsSync(path)) {
    try {
      sessions = JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
    } catch {
      sessions = {};
    }
  }
  const save = () => writeJson(path, sessions);
  return {
    create(userId) {
      const token = `${userId}.${crypto.randomUUID()}`;
      sessions[token] = userId;
      save();
      return token;
    },
    get: (token) => (token ? sessions[token] : undefined),
    delete(token) {
      if (token && sessions[token]) {
        delete sessions[token];
        save();
      }
    },
  };
}
