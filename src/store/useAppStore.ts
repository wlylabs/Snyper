"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Settings } from "@/lib/types";

export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  localeChosen: false,
  theme: "dark",
};

type AppState = {
  settings: Settings;
  hydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  setHydrated: () => void;
};

/**
 * The reader's own state, which for now is a language and a theme.
 *
 * The key carries a version because the release that emptied the app left
 * records behind — armed strategies, a signal queue, a local trade ledger —
 * that nothing here can read any more. Starting on a new key is what keeps a
 * returning reader from being merged with state no screen can show, and costs
 * them nothing but a theme they set once.
 */
export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      hydrated: false,

      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "snyper.state.v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ settings: state.settings }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
