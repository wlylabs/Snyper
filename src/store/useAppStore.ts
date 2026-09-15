"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Token } from "@/lib/tokens";
import { resolveVenue, setActiveVenue, type VenueConfig } from "@/lib/venue";
import type {
  Bot,
  BotRuntime,
  OrderStage,
  PricePoint,
  Settings,
  Signal,
  Trade,
} from "@/lib/types";

const MAX_SERIES_POINTS = 360;
const MAX_SIGNALS = 200;
const MAX_TRADES = 200;
const MAX_DISCOVERED = 300;

export const DEFAULT_SETTINGS: Settings = {
  locale: "en",
  localeChosen: false,
  currency: "USD",
  slippageBps: 50,
  deadlineMinutes: 20,
  tickSeconds: 30,
  theme: "dark",
  autoDispatch: false,
  presetsNative: [0.05, 0.1, 0.25, 0.5],
  presetsStable: [25, 50, 100, 250],
  priorityFeeGwei: 0,
  maxImpactBps: 1_500,
};

/**
 * Recomputes the active routing venue and mirrors it into `venue.ts`, whose
 * synchronous readers sit under quoting, routing and position maths. Called
 * from the store rather than from a component so the mirror is always current
 * before any render that can see `venueKey` change.
 */
function syncVenue(manual?: VenueConfig, discovered?: VenueConfig): string {
  const venue = resolveVenue(manual, discovered);
  setActiveVenue(venue);
  if (!venue) return "none";
  return [
    venue.source,
    venue.factory,
    venue.router,
    venue.wrapped,
    venue.quoter ?? "",
    venue.stable ?? "",
  ].join(":");
}

export function seriesKey(chainId: number, base: Token, quote: Token): string {
  return `${chainId}:${base.address.toLowerCase()}:${quote.address.toLowerCase()}`;
}

export function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function emptyRuntime(): BotRuntime {
  return { filledLevels: [], spentQuote: 0, deployedQuote: 0, fills: 0 };
}

type AppState = {
  bots: Bot[];
  signals: Signal[];
  trades: Trade[];
  series: Record<string, PricePoint[]>;
  settings: Settings;
  customTokens: Token[];
  /** Tokens found by scanning the wallet's own transfer history. */
  discoveredTokens: Token[];
  /** Venue addresses the operator entered by hand. */
  venueManual?: VenueConfig;
  /** Venue addresses read off the Pons launchpad's own DEX config. */
  venueDiscovered?: VenueConfig;
  /** Identity of the venue in force; changes when it resolves or is edited. */
  venueKey: string;
  hydrated: boolean;

  addBot: (bot: Bot) => void;
  updateBot: (id: string, patch: Partial<Omit<Bot, "runtime">>) => void;
  patchRuntime: (id: string, patch: Partial<BotRuntime>) => void;
  removeBot: (id: string) => void;
  setBotStatus: (id: string, status: Bot["status"]) => void;
  resetBot: (id: string) => void;
  closeOrder: (id: string, stage: Extract<OrderStage, "expired" | "cancelled">) => void;

  pushSignal: (signal: Signal) => void;
  updateSignal: (id: string, patch: Partial<Signal>) => void;
  clearSignals: (filter?: (signal: Signal) => boolean) => void;

  pushTrade: (trade: Trade) => void;
  updateTrade: (hash: string, patch: Partial<Trade>) => void;

  recordPrice: (key: string, point: PricePoint) => void;

  setSettings: (patch: Partial<Settings>) => void;
  setVenueManual: (config: VenueConfig | undefined) => void;
  setVenueDiscovered: (config: VenueConfig | undefined) => void;
  addCustomToken: (token: Token) => void;
  addDiscoveredTokens: (tokens: Token[]) => void;
  setHydrated: () => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      bots: [],
      signals: [],
      trades: [],
      series: {},
      settings: DEFAULT_SETTINGS,
      customTokens: [],
      discoveredTokens: [],
      venueManual: undefined,
      venueDiscovered: undefined,
      venueKey: syncVenue(),
      hydrated: false,

      addBot: (bot) => set((state) => ({ bots: [bot, ...state.bots] })),

      updateBot: (id, patch) =>
        set((state) => ({
          bots: state.bots.map((bot) => (bot.id === id ? { ...bot, ...patch } : bot)),
        })),

      patchRuntime: (id, patch) =>
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.id === id ? { ...bot, runtime: { ...bot.runtime, ...patch } } : bot,
          ),
        })),

      removeBot: (id) =>
        set((state) => ({
          bots: state.bots.filter((bot) => bot.id !== id),
          signals: state.signals.filter((signal) => signal.botId !== id),
        })),

      setBotStatus: (id, status) =>
        set((state) => ({
          bots: state.bots.map((bot) => (bot.id === id ? { ...bot, status } : bot)),
        })),

      resetBot: (id) =>
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.id === id ? { ...bot, status: "idle", runtime: emptyRuntime() } : bot,
          ),
        })),

      /**
       * Retires an order that never reached a position. Signals still waiting
       * for a signature go with it — an order that has given up must not be
       * able to buy later at a price nobody agreed to.
       */
      closeOrder: (id, stage) =>
        set((state) => ({
          bots: state.bots.map((bot) =>
            bot.id === id
              ? {
                  ...bot,
                  status: "idle",
                  runtime: { ...bot.runtime, stage, completed: true, error: undefined },
                }
              : bot,
          ),
          signals: state.signals.map((signal) =>
            signal.botId === id && signal.status === "pending"
              ? { ...signal, status: "cancelled" }
              : signal,
          ),
        })),

      pushSignal: (signal) =>
        set((state) => ({ signals: [signal, ...state.signals].slice(0, MAX_SIGNALS) })),

      updateSignal: (id, patch) =>
        set((state) => ({
          signals: state.signals.map((signal) =>
            signal.id === id ? { ...signal, ...patch } : signal,
          ),
        })),

      clearSignals: (filter) =>
        set((state) => ({
          signals: filter ? state.signals.filter((signal) => !filter(signal)) : [],
        })),

      pushTrade: (trade) =>
        set((state) => ({ trades: [trade, ...state.trades].slice(0, MAX_TRADES) })),

      updateTrade: (hash, patch) =>
        set((state) => ({
          trades: state.trades.map((trade) =>
            trade.hash === hash ? { ...trade, ...patch } : trade,
          ),
        })),

      recordPrice: (key, point) =>
        set((state) => {
          const previous = state.series[key] ?? [];
          const last = previous[previous.length - 1];
          if (last && point.t - last.t < 1000) return state;
          const next = [...previous, point].slice(-MAX_SERIES_POINTS);
          return { series: { ...state.series, [key]: next } };
        }),

      setSettings: (patch) =>
        set((state) => ({ settings: { ...state.settings, ...patch } })),

      addCustomToken: (token) =>
        set((state) => {
          const exists = state.customTokens.some(
            (t) =>
              t.chainId === token.chainId &&
              t.address.toLowerCase() === token.address.toLowerCase(),
          );
          return exists ? state : { customTokens: [...state.customTokens, token] };
        }),

      addDiscoveredTokens: (tokens) =>
        set((state) => {
          const seen = new Set(
            state.discoveredTokens.map(
              (token) => `${token.chainId}:${token.address.toLowerCase()}`,
            ),
          );
          const additions = tokens.filter((token) => {
            const key = `${token.chainId}:${token.address.toLowerCase()}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (additions.length === 0) return state;
          return {
            discoveredTokens: [...state.discoveredTokens, ...additions].slice(
              -MAX_DISCOVERED,
            ),
          };
        }),

      setVenueManual: (config) =>
        set((state) => ({
          venueManual: config,
          venueKey: syncVenue(config, state.venueDiscovered),
        })),

      setVenueDiscovered: (config) =>
        set((state) => ({
          venueDiscovered: config,
          venueKey: syncVenue(state.venueManual, config),
        })),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: "snyper.state.v1",
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        bots: state.bots,
        signals: state.signals,
        trades: state.trades,
        series: state.series,
        settings: state.settings,
        customTokens: state.customTokens,
        discoveredTokens: state.discoveredTokens,
        venueManual: state.venueManual,
        venueDiscovered: state.venueDiscovered,
      }),
      /**
       * Persisted state is merged key by key, and `settings` is merged one level
       * deeper, so a release that adds a setting does not leave it undefined for
       * anyone who already has state in this browser.
       */
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AppState>;
        return {
          ...current,
          ...saved,
          settings: { ...current.settings, ...(saved.settings ?? {}) },
        };
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // The stored venue has to reach the mirror before anything prices
        // against it, so it is applied here rather than waiting for a render.
        useAppStore.setState({
          venueKey: syncVenue(state.venueManual, state.venueDiscovered),
        });
        state.setHydrated();
      },
    },
  ),
);
