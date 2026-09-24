import { clearAllDrafts, draftKey, readDraft, removeDraft, writeDraft } from "./drafts";
import { useSession } from "./session";

describe("drafts", () => {
  beforeEach(() => localStorage.clear());

  it("keys drafts by user so another user never sees them", () => {
    writeDraft("u-1", "claim", { description: "no cooling" });
    expect(readDraft("u-1", "claim")).toEqual({ description: "no cooling" });
    expect(readDraft("u-2", "claim")).toBeNull();
    expect(localStorage.getItem(draftKey("u-1", "claim"))).not.toBeNull();
  });

  it("does nothing without a user", () => {
    writeDraft(undefined, "claim", { description: "x" });
    expect(localStorage.length).toBe(0);
    expect(readDraft(undefined, "claim")).toBeNull();
  });

  it("removes a single draft", () => {
    writeDraft("u-1", "claim", { a: 1 });
    removeDraft("u-1", "claim");
    expect(readDraft("u-1", "claim")).toBeNull();
  });

  it("clears every draft, including the legacy unscoped key, but keeps other storage", () => {
    writeDraft("u-1", "claim", { a: 1 });
    writeDraft("u-2", "claim", { b: 2 });
    localStorage.setItem("fp-wms-claim-draft", "{}");
    localStorage.setItem("wms-lang", "en");
    clearAllDrafts();
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem("wms-lang")).toBe("en");
  });

  it("ignores unreadable JSON", () => {
    localStorage.setItem(draftKey("u-1", "claim"), "{not json");
    expect(readDraft("u-1", "claim")).toBeNull();
  });

  it("is wiped on sign-out", () => {
    writeDraft("u-1", "claim", { description: "secret" });
    useSession.getState().signOut();
    expect(readDraft("u-1", "claim")).toBeNull();
  });
});
