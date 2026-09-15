"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { midPrice } from "@/lib/quote";
import { safeParseUnits } from "@/lib/format";
import { evaluate, withinLimits, type Intent } from "@/lib/snype";
import type { Signal, Snype } from "@/lib/types";
import { seriesKey, useAppStore } from "@/store/useAppStore";
import { readableError } from "@/hooks/useExecutor";
import { useDispatchSignal } from "@/hooks/useDispatchSignal";
import { useI18n } from "@/hooks/useI18n";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function intentToSignal(snype: Snype, intent: Intent, price: number): Signal | undefined {
  const buying = intent.side === "buy";
  const tokenIn = buying ? snype.quote : snype.base;
  const tokenOut = buying ? snype.base : snype.quote;

  let amountIn: bigint | undefined;
  if (!buying && intent.amountBaseRaw !== undefined) {
    // Already in base units. Routing a full exit through a float would shave
    // digits off the size and leave dust the next leg cannot spend.
    try {
      amountIn = BigInt(intent.amountBaseRaw);
    } catch {
      return undefined;
    }
  } else {
    const amount = intent.amountQuote;
    if (!amount || amount <= 0) return undefined;
    amountIn = safeParseUnits(
      amount.toFixed(Math.min(tokenIn.decimals, 12)),
      tokenIn.decimals,
    );
  }
  if (!amountIn || amountIn <= 0n) return undefined;

  return {
    id: newId(),
    snypeId: snype.id,
    snypeName: snype.name,
    chainId: snype.chainId,
    createdAt: Date.now(),
    side: intent.side,
    reason: intent.reason,
    tokenIn,
    tokenOut,
    amountIn: amountIn.toString(),
    price,
    status: "pending",
    leg: intent.leg,
  };
}

/**
 * Headless snype loop. It reads pool prices on an interval, records every
 * observed tick, and turns a snype's own targets into signals. Execution always
 * goes through the connected wallet — the app holds no keys and pre-signs
 * nothing.
 */
export function SnypeRunner() {
  const config = useConfig();
  const { address, chainId } = useAccount();
  const tickSeconds = useAppStore((state) => state.settings.tickSeconds);
  const { t } = useI18n();
  // Held in a ref so switching language does not restart the interval.
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
        const armed = store.snypes.filter(
          (snype) => snype.status === "armed" && !snype.runtime.completed,
        );
        if (armed.length === 0) return;

        const now = Date.now();

        for (const snype of armed) {
          // An entry that never came gives up on its own. Only the waiting
          // stage is timed: once a position exists, its take profit and cut
          // loss run until one of them closes it.
          const waitingEntry = (snype.runtime.stage ?? "waiting") === "waiting";
          if (waitingEntry && now >= snype.plan.expiresAt) {
            useAppStore.getState().closeSnype(snype.id, "expired");
            continue;
          }

          const client = getPublicClient(config, { chainId: snype.chainId });
          if (!client) continue;

          let price: number | undefined;
          try {
            const mid = await midPrice(client, snype.base, snype.quote);
            price = mid?.price;
          } catch (error) {
            useAppStore
              .getState()
              .patchRuntime(snype.id, { error: readableError(error, tRef.current) });
            continue;
          }
          if (!price) {
            useAppStore.getState().patchRuntime(snype.id, {
              lastTickAt: now,
              error: tRef.current("error.noPool"),
            });
            continue;
          }

          useAppStore
            .getState()
            .recordPrice(seriesKey(snype.chainId, snype.base, snype.quote), {
              t: now,
              p: price,
            });

          useAppStore.getState().patchRuntime(snype.id, {
            lastTickAt: now,
            lastPrice: price,
            error: undefined,
          });

          const current = useAppStore.getState().snypes.find((item) => item.id === snype.id);
          if (!current) continue;

          const hasOpen = useAppStore
            .getState()
            .signals.some(
              (signal) =>
                signal.snypeId === snype.id &&
                (signal.status === "pending" || signal.status === "executing"),
            );
          if (hasOpen) continue;

          // A dispatch interrupted mid-signature (tab closed, wallet dismissed
          // without an error) leaves the entry parked in a stage nothing
          // evaluates. With no signal left open, hand it back to where it was.
          const stalled = current.runtime.completed
            ? undefined
            : current.runtime.stage === "entering"
              ? "waiting"
              : current.runtime.stage === "exiting"
                ? "holding"
                : undefined;
          if (stalled) {
            useAppStore.getState().patchRuntime(snype.id, { stage: stalled });
            continue;
          }

          const intent = evaluate(current, price, now);
          if (!intent) continue;

          const gate = withinLimits(current, intent, price);
          if (!gate.ok) {
            useAppStore
              .getState()
              .patchRuntime(snype.id, { error: tRef.current(gate.reason) });
            continue;
          }

          const signal = intentToSignal(current, intent, price);
          if (!signal) continue;

          useAppStore.getState().pushSignal(signal);
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

      const next = store.signals
        .filter((signal) => signal.status === "pending" && signal.chainId === chainId)
        .sort((a, b) => a.createdAt - b.createdAt)[0];
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
