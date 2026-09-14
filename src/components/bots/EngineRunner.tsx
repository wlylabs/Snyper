"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { midPrice } from "@/lib/quote";
import { safeParseUnits } from "@/lib/format";
import { evaluate, withinRiskLimits, type Intent } from "@/lib/strategies";
import type { Bot, Signal } from "@/lib/types";
import { seriesKey, todayKey, useAppStore } from "@/store/useAppStore";
import { readableError } from "@/hooks/useExecutor";
import { useDispatchSignal } from "@/hooks/useDispatchSignal";
import { useI18n } from "@/hooks/useI18n";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function intentToSignal(bot: Bot, intent: Intent, price: number): Signal | undefined {
  const buying = intent.side === "buy";
  const tokenIn = buying ? bot.quote : bot.base;
  const tokenOut = buying ? bot.base : bot.quote;
  const amount = buying ? intent.amountQuote : intent.amountBase;
  if (!amount || amount <= 0) return undefined;

  const amountIn = safeParseUnits(amount.toFixed(Math.min(tokenIn.decimals, 12)), tokenIn.decimals);
  if (!amountIn || amountIn <= 0n) return undefined;

  return {
    id: newId(),
    botId: bot.id,
    botName: bot.name,
    chainId: bot.chainId,
    createdAt: Date.now(),
    side: intent.side,
    reason: intent.reason,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    price,
    status: "pending",
    level: intent.level,
  };
}

/**
 * Headless strategy loop. It reads pool prices on an interval, records every
 * observed tick, and turns strategy output into signals. Execution always goes
 * through the connected wallet — the app holds no keys and pre-signs nothing.
 */
export function EngineRunner() {
  const config = useConfig();
  const { address, chainId } = useAccount();
  const tickSeconds = useAppStore((state) => state.settings.tickSeconds);
  const { t } = useI18n();
  // Held in a ref so switching language does not restart the strategy interval.
  const tRef = useRef(t);
  const running = useRef(false);
  const dispatching = useRef(false);

  const dispatch = useDispatchSignal();

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const interval = Math.max(10, Math.min(600, tickSeconds)) * 1000;

    const tick = async () => {
      if (running.current) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      running.current = true;
      try {
        const store = useAppStore.getState();
        const armed = store.bots.filter((bot) => bot.status === "armed" && !bot.runtime.completed);
        if (armed.length === 0) return;

        const now = Date.now();
        const today = todayKey(now);

        for (const bot of armed) {
          const client = getPublicClient(config, { chainId: bot.chainId });
          if (!client) continue;

          let price: number | undefined;
          try {
            const mid = await midPrice(client, bot.base, bot.quote);
            price = mid?.price;
          } catch (error) {
            useAppStore
              .getState()
              .patchRuntime(bot.id, { error: readableError(error, tRef.current) });
            continue;
          }
          if (!price) {
            useAppStore
              .getState()
              .patchRuntime(bot.id, {
                lastTickAt: now,
                error: tRef.current("error.noPool"),
              });
            continue;
          }

          useAppStore.getState().recordPrice(seriesKey(bot.chainId, bot.base, bot.quote), {
            t: now,
            p: price,
          });

          const peak = Math.max(bot.runtime.peak ?? 0, price);
          const activated =
            bot.runtime.activated ||
            (bot.strategy.kind === "trail" &&
              (bot.strategy.activation <= 0 || price >= bot.strategy.activation));

          useAppStore.getState().patchRuntime(bot.id, {
            lastTickAt: now,
            lastPrice: price,
            peak,
            activated,
            error: undefined,
          });

          const current = useAppStore.getState().bots.find((item) => item.id === bot.id);
          if (!current) continue;

          const hasOpen = useAppStore
            .getState()
            .signals.some(
              (signal) =>
                signal.botId === bot.id &&
                (signal.status === "pending" || signal.status === "executing"),
            );
          if (hasOpen) continue;

          const intent = evaluate(current, price, now);
          if (!intent) continue;

          const gate = withinRiskLimits(current, intent, price, today);
          if (!gate.ok) {
            useAppStore
              .getState()
              .patchRuntime(bot.id, { error: tRef.current(gate.reason) });
            continue;
          }

          const signal = intentToSignal(current, intent, price);
          if (signal) useAppStore.getState().pushSignal(signal);
        }
      } finally {
        running.current = false;
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), interval);
    return () => window.clearInterval(id);
  }, [config, tickSeconds]);

  // Auto execution: one signal at a time, always through the wallet.
  useEffect(() => {
    const drain = async () => {
      if (dispatching.current) return;
      const store = useAppStore.getState();
      if (!store.settings.autoDispatch || !address) return;

      const pending = store.signals
        .filter((signal) => signal.status === "pending")
        .filter((signal) => {
          const bot = store.bots.find((item) => item.id === signal.botId);
          return bot?.execution === "auto" && signal.chainId === chainId;
        })
        .sort((a, b) => a.createdAt - b.createdAt);

      const next = pending[0];
      if (!next) return;

      dispatching.current = true;
      try {
        await dispatch(next);
      } finally {
        dispatching.current = false;
      }
    };

    void drain();
    const unsubscribe = useAppStore.subscribe(() => void drain());
    const id = window.setInterval(() => void drain(), 5_000);
    return () => {
      unsubscribe();
      window.clearInterval(id);
    };
  }, [address, chainId, dispatch]);

  return null;
}
