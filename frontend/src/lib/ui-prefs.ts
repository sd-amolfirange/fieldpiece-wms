import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

// UI preferences only (Section 2.1). Safe for localStorage: nothing sensitive lives here.

export type Theme = "light" | "dark";

interface UiPrefsState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setMobileNavOpen: (open: boolean) => void;
  setTheme: (theme: Theme) => void;
}

// In-memory fallback for private windows or blocked storage.
const memory = new Map<string, string>();
const memoryStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

function browserStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem("wms-ui");
    return storage;
  } catch {
    return memoryStorage;
  }
}

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      theme: "light",
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setMobileNavOpen: (open) => set({ mobileNavOpen: open }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "wms-ui",
      storage: createJSONStorage(browserStorage),
      partialize: ({ sidebarCollapsed, theme }) => ({ sidebarCollapsed, theme }),
    },
  ),
);
