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
  /**
   * Contracts the reader has put out of sight, lowercased.
   *
   * Nothing is deleted by this and nothing can be: a token is in the wallet
   * whether or not a screen lists it. This is the app's record of what not to
   * show — which is why it is the reader's state and not the chain's, and why
   * it survives a reload.
   */
  hidden: string[];
  hydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  setHidden: (address: string, hidden: boolean) => void;
  setHydrated: () => void;
};

/**
 * The reader's own state: a language, a theme, and the tokens they have asked
 * this app to stop listing.
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
      hidden: [],
      hydrated: false,

      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      setHidden: (address, hidden) =>
        set((state) => {
          const key = address.toLowerCase();
          const without = state.hidden.filter((entry) => entry !== key);
          return { hidden: hidden ? [...without, key] : without };
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "snyper.state.v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ settings: state.settings, hidden: state.hidden }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
