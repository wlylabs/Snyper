"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Token } from "@/lib/tokens";
import { resolveVenue, setActiveVenue, type VenueConfig } from "@/lib/venue";
import type {
  PricePoint,
  Settings,
  Signal,
  Snype,
  SnypeRuntime,
  SnypeStage,
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

export function emptyRuntime(): SnypeRuntime {
  return { fills: 0 };
}

type AppState = {
  snypes: Snype[];
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

  addSnype: (snype: Snype) => void;
  patchRuntime: (id: string, patch: Partial<SnypeRuntime>) => void;
  removeSnype: (id: string) => void;
  setSnypeStatus: (id: string, status: Snype["status"]) => void;
  closeSnype: (id: string, stage: Extract<SnypeStage, "expired" | "cancelled">) => void;

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

/**
 * State written before this release carried a list of `bots`, each one a
 * strategy of its own kind. Only the one-shot order survived — it is what a
 * snype is now — so the bots that were something else are dropped rather than
 * left in the list as entries nothing can evaluate.
 */
type LegacyBot = {
  id?: string;
  name?: string;
  chainId?: number;
  base?: Token;
  quote?: Token;
  strategy?: { kind?: string } & Record<string, unknown>;
  slippageBps?: number;
  cooldownSec?: number;
  status?: Snype["status"];
  createdAt?: number;
  runtime?: Record<string, unknown>;
};

function migrateBot(bot: LegacyBot): Snype | undefined {
  const strategy = bot.strategy;
  if (!strategy || strategy.kind !== "order") return undefined;
  if (!bot.id || !bot.base || !bot.quote || !bot.chainId) return undefined;
  const runtime = (bot.runtime ?? {}) as Record<string, unknown>;
  return {
    id: bot.id,
    name: bot.name ?? bot.base.symbol,
    chainId: bot.chainId,
    base: bot.base,
    quote: bot.quote,
    plan: {
      amountQuote: Number(strategy.amountQuote ?? 0),
      entryPrice: Number(strategy.entryPrice ?? 0),
      takeProfitPct: Number(strategy.takeProfitPct ?? 0),
      cutLossPct: Number(strategy.cutLossPct ?? 0),
      expiresAt: Number(strategy.expiresAt ?? 0),
    },
    slippageBps: bot.slippageBps ?? 100,
    cooldownSec: bot.cooldownSec ?? 30,
    status: bot.status === "armed" ? "armed" : "idle",
    createdAt: bot.createdAt ?? Date.now(),
    runtime: {
      fills: Number(runtime.fills ?? 0),
      lastTickAt: runtime.lastTickAt as number | undefined,
      lastFireAt: runtime.lastFireAt as number | undefined,
      lastPrice: runtime.lastPrice as number | undefined,
      completed: runtime.completed as boolean | undefined,
      error: runtime.error as string | undefined,
      stage: runtime.stage as SnypeStage | undefined,
      fillPrice: runtime.fillPrice as number | undefined,
      positionBase: runtime.positionBase as string | undefined,
      exitReason: runtime.exitReason as Snype["runtime"]["exitReason"],
    },
  };
}

function migrateState(persisted: unknown): Record<string, unknown> {
  const state = { ...((persisted ?? {}) as Record<string, unknown>) };
  const bots = state.bots as LegacyBot[] | undefined;
  if (Array.isArray(bots)) {
    const snypes = bots.map(migrateBot).filter((snype): snype is Snype => Boolean(snype));
    const kept = new Set(snypes.map((snype) => snype.id));
    state.snypes = snypes;
    const signals = state.signals as (Signal & { botId?: string; botName?: string })[] | undefined;
    if (Array.isArray(signals)) {
      state.signals = signals
        .map((signal) => ({
          ...signal,
          snypeId: signal.snypeId ?? signal.botId ?? "",
          snypeName: signal.snypeName ?? signal.botName ?? "",
        }))
        .filter((signal) => kept.has(signal.snypeId));
    }
  }
  delete state.bots;
  const trades = state.trades as (Trade & { botName?: string; source?: string })[] | undefined;
  if (Array.isArray(trades)) {
    state.trades = trades.map((trade) => ({
      ...trade,
      source: trade.source === "terminal" ? "terminal" : "snype",
      snypeName: trade.snypeName ?? trade.botName,
    }));
  }
  return state;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      snypes: [],
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

      addSnype: (snype) => set((state) => ({ snypes: [snype, ...state.snypes] })),

      patchRuntime: (id, patch) =>
        set((state) => ({
          snypes: state.snypes.map((snype) =>
            snype.id === id ? { ...snype, runtime: { ...snype.runtime, ...patch } } : snype,
          ),
        })),

      removeSnype: (id) =>
        set((state) => ({
          snypes: state.snypes.filter((snype) => snype.id !== id),
          signals: state.signals.filter((signal) => signal.snypeId !== id),
        })),

      setSnypeStatus: (id, status) =>
        set((state) => ({
          snypes: state.snypes.map((snype) =>
            snype.id === id ? { ...snype, status } : snype,
          ),
        })),

      /**
       * Retires a snype that never reached a position. Signals still waiting
       * for a signature go with it — a snype that has given up must not be
       * able to buy later at a price nobody agreed to.
       */
      closeSnype: (id, stage) =>
        set((state) => ({
          snypes: state.snypes.map((snype) =>
            snype.id === id
              ? {
                  ...snype,
                  status: "idle",
                  runtime: { ...snype.runtime, stage, completed: true, error: undefined },
                }
              : snype,
          ),
          signals: state.signals.map((signal) =>
            signal.snypeId === id && signal.status === "pending"
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
      version: 5,
      storage: createJSONStorage(() => localStorage),
      /**
       * Token artwork kept by earlier releases is dropped rather than carried.
       * Nothing draws it now, and on a browser that has scanned a wallet it is
       * the largest thing this store holds.
       */
      migrate: (persisted, version) => {
        const state =
          version < 4
            ? migrateState(persisted)
            : { ...((persisted ?? {}) as Record<string, unknown>) };
        delete state.tokenLogos;
        return state;
      },
      partialize: (state) => ({
        snypes: state.snypes,
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
