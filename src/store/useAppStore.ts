"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Settings } from "@/lib/types";

/**
 * What a reader has put into a token through this app, and taken back out.
 *
 * Both in dollars at the moment of the trade, because that is the unit a
 * position is held in: a basis kept in the coin would fold a bet on the coin
 * into every memecoin's profit and loss, and the reader did not make that bet.
 *
 * This is a cost basis and not a trade log. The chain already keeps the log,
 * and an app that kept its own would be inventing a second history to disagree
 * with it. Two running totals per token is the least that can answer "am I up",
 * and nothing here is ever read back as fact about the chain.
 */
export type Basis = { spent: number; received: number };

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
  /** Cost basis by contract, lowercased. See `Basis`. */
  basis: Record<string, Basis>;
  hydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  setHidden: (address: string, hidden: boolean) => void;
  record: (address: string, side: "spent" | "received", usd: number) => void;
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
      basis: {},
      hydrated: false,

      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      setHidden: (address, hidden) =>
        set((state) => {
          const key = address.toLowerCase();
          const without = state.hidden.filter((entry) => entry !== key);
          return { hidden: hidden ? [...without, key] : without };
        }),

      /*
       * Added to rather than replaced: a reader who buys the same token twice
       * has one position in it, and the second fill is part of what the first
       * one cost them. A figure that is not a positive number is dropped rather
       * than stored, so a failed conversion cannot quietly corrupt a basis.
       */
      record: (address, side, usd) =>
        set((state) => {
          if (!Number.isFinite(usd) || usd <= 0) return state;
          const key = address.toLowerCase();
          const held = state.basis[key] ?? { spent: 0, received: 0 };
          return {
            basis: { ...state.basis, [key]: { ...held, [side]: held[side] + usd } },
          };
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "snyper.state.v2",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        hidden: state.hidden,
        basis: state.basis,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
