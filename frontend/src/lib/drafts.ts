// Local form drafts (offline fallback for autosave). Keys are scoped to the signed-in user so a
// shared device never pre-fills one user's data for another, and every draft is wiped on sign-out.

const PREFIX = "wms-draft:";

export const draftKey = (userId: string, form: string) => `${PREFIX}${userId}:${form}`;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft<T>(userId: string | undefined, form: string): Partial<T> | null {
  if (!userId) return null;
  try {
    const raw = storage()?.getItem(draftKey(userId, form));
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

export function writeDraft(userId: string | undefined, form: string, value: unknown): void {
  if (!userId) return;
  try {
    storage()?.setItem(draftKey(userId, form), JSON.stringify(value));
  } catch {
    // storage blocked or full: the draft just won't survive a reload
  }
}

export function removeDraft(userId: string | undefined, form: string): void {
  if (!userId) return;
  try {
    storage()?.removeItem(draftKey(userId, form));
  } catch {
    // ignore
  }
}

/** Removes every user's drafts, plus the unscoped key used before drafts were per-user. */
export function clearAllDrafts(): void {
  const store = storage();
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
      (key): key is string => !!key && (key.startsWith(PREFIX) || key === "fp-wms-claim-draft"),
    );
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // ignore
  }
}
