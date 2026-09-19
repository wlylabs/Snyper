"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Settings } from "@/lib/types";
import type { Pair } from "@/hooks/useScreener";

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
  /**
   * A pair handed from one screen to another, on its way to the terminal.
   *
   * The memecoin screens are where a target is found and the terminal is where
   * it is shot at, and until now the two could not say a word to each other —
   * a reader who spotted something had to remember its ticker, walk to the
   * other screen and find it again in a list that may not even carry it.
   *
   * The whole pair travels rather than its address, because the terminal can
   * quote anything it is handed and the lists do not agree on what they hold:
   * a launch with no trades in the last five minutes is not in the terminal's
   * own list and is perfectly buyable. It is deliberately not persisted — an
   * aim is a thing you take now, not something to find still pointed somewhere
   * a day later.
   */
  aimed?: Pair;
  hydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  setHidden: (address: string, hidden: boolean) => void;
  record: (address: string, side: "spent" | "received", usd: number) => void;
  aim: (pair: Pair | undefined) => void;
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

      aim: (pair) => set({ aimed: pair }),

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
