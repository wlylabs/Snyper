"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { remember, type Watch, type Watchable } from "@/lib/memory";
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

/**
 * Which wallet's money this was.
 *
 * A basis used to be filed under the token alone, which quietly assumed a
 * browser only ever holds one wallet. This app attracts the opposite: a reader
 * snipes from a burner and keeps the rest somewhere else, and both connect from
 * the same browser. Under the old key the second wallet inherited the first
 * one's spending and the position screen printed a profit on units it had never
 * bought — the one number on that screen a reader has no way to check.
 *
 * So the owner is part of the key. It also makes true the promise the terminal
 * already makes in prose: that a wallet holding units this app did not buy is
 * shown no P&L at all rather than somebody else's.
 */
export function basisKey(owner: string | undefined, token: string): string | undefined {
  return owner ? `${owner.toLowerCase()}:${token.toLowerCase()}` : undefined;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  localeChosen: false,
  theme: "dark",
  masked: false,
  currency: "USD",
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
  /** Cost basis by wallet and contract, lowercased. See `basisKey`. */
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
  /**
   * What the memecoin screen has seen the chain do, reading by reading.
   *
   * The one piece of state here that is about the chain rather than about the
   * reader, and it is here for the same reason the rest is: it has to survive
   * a reload. Everything this app can see of the chain is five minutes wide —
   * see `lib/memory` — and the only way past that is to remember the last
   * reading before taking the next. A store that forgot on every navigation
   * would be a screen that never got past five minutes however long it was
   * left open.
   */
  watch: Watch;
  hydrated: boolean;

  setSettings: (patch: Partial<Settings>) => void;
  setHidden: (address: string, hidden: boolean) => void;
  record: (
    owner: string | undefined,
    address: string,
    side: "spent" | "received",
    usd: number,
  ) => void;
  aim: (pair: Pair | undefined) => void;
  observe: (rows: readonly Watchable[], head: bigint) => void;
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
      watch: {},
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
       *
       * A fill with no wallet behind it is dropped outright. There is no such
       * thing as a disconnected trade, so this can only be a race between a
       * receipt landing and the session going away — and a basis filed under
       * nobody is the very thing the key above exists to prevent.
       */
      record: (owner, address, side, usd) =>
        set((state) => {
          if (!Number.isFinite(usd) || usd <= 0) return state;
          const key = basisKey(owner, address);
          if (!key) return state;
          const held = state.basis[key] ?? { spent: 0, received: 0 };
          return {
            basis: { ...state.basis, [key]: { ...held, [side]: held[side] + usd } },
          };
        }),

      aim: (pair) => set({ aimed: pair }),

      /*
       * Whether this reading is worth keeping is decided inside the update
       * rather than by the caller, against the readings already held. Two
       * screens can be reading the same query at once, and the second of them
       * has to find the window already recorded — which it does, because
       * `remember` is comparing against state rather than against whatever the
       * caller captured when its effect was scheduled. When nothing is taken
       * it hands the same object back and nothing re-renders.
       */
      observe: (rows, head) =>
        set((state) => {
          const watch = remember(state.watch, rows, head);
          return watch === state.watch ? state : { watch };
        }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "snyper.state.v2",
      storage: createJSONStorage(() => localStorage),
      /*
       * One version, for one change: the basis key gained an owner.
       *
       * The old entries are dropped rather than carried across, and there is no
       * honest alternative — a figure filed under a token alone does not record
       * which wallet spent it, and the only way to keep it would be to assign it
       * to whichever wallet connects next. That is the bug, performed once more
       * on the way out. What a reader loses is the P&L line on positions opened
       * before this release; what they gain is that the line is never wrong.
       */
      version: 1,
      migrate: (persisted, from) => {
        const state = persisted as Partial<AppState> | undefined;
        if (!state || from >= 1) return state as AppState;
        return { ...state, basis: {} } as AppState;
      },
      partialize: (state) => ({
        settings: state.settings,
        hidden: state.hidden,
        basis: state.basis,
        watch: state.watch,
      }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
