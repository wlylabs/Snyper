"use client";

import { useEffect, useRef } from "react";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient, readContract } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi";
import { midPrice } from "@/lib/quote";
import { safeParseUnits } from "@/lib/format";
import { snipeGate } from "@/lib/snipe";
import { evaluate, isStaged, withinRiskLimits, type Intent } from "@/lib/strategies";
import type { Bot, Signal } from "@/lib/types";
import { seriesKey, todayKey, useAppStore } from "@/store/useAppStore";
import { readableError } from "@/hooks/useExecutor";
import { useDispatchSignal } from "@/hooks/useDispatchSignal";
import { useI18n } from "@/hooks/useI18n";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * What the wallet is holding of a token right now. A protect watch guards the
 * balance rather than a position it opened itself, so it has to look.
 */
async function walletBalance(
  config: ReturnType<typeof useConfig>,
  bot: Bot,
  owner: `0x${string}` | undefined,
): Promise<bigint | undefined> {
  if (!owner) return undefined;
  try {
    if (bot.base.native) {
      const client = getPublicClient(config, { chainId: bot.chainId });
      return client ? await client.getBalance({ address: owner }) : undefined;
    }
    return (await readContract(config, {
      address: bot.base.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
      chainId: bot.chainId,
    })) as bigint;
  } catch {
    return undefined;
  }
}

function intentToSignal(bot: Bot, intent: Intent, price: number): Signal | undefined {
  const buying = intent.side === "buy";
  const tokenIn = buying ? bot.quote : bot.base;
  const tokenOut = buying ? bot.base : bot.quote;

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
    const amount = buying ? intent.amountQuote : intent.amountBase;
    if (!amount || amount <= 0) return undefined;
    amountIn = safeParseUnits(
      amount.toFixed(Math.min(tokenIn.decimals, 12)),
      tokenIn.decimals,
    );
  }
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
    leg: intent.leg,
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
  // Held in a ref for the same reason as the translator: reconnecting a wallet
  // must not tear down and restart the strategy interval.
  const addressRef = useRef(address);

  const dispatch = useDispatchSignal();

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    addressRef.current = address;
  }, [address]);

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
          // An entry that never came gives up on its own — an order that never
          // traded down to its price, a snipe whose pool never opened. Only the
          // waiting stage is timed: once a position exists, its take profit and
          // cut loss run until one of them closes it.
          const waitingEntry =
            isStaged(bot.strategy) && (bot.runtime.stage ?? "waiting") === "waiting";
          if (
            isStaged(bot.strategy) &&
            waitingEntry &&
            now >= bot.strategy.expiresAt
          ) {
            useAppStore.getState().closeOrder(bot.id, "expired");
            continue;
          }

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
            // A snipe with no pool yet is not broken; it is doing its one job.
            const watching = bot.strategy.kind === "snipe" && waitingEntry;
            useAppStore.getState().patchRuntime(bot.id, {
              lastTickAt: now,
              error: watching ? undefined : tRef.current("error.noPool"),
              note: watching ? tRef.current("reason.snipeNoPool") : undefined,
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
            note: undefined,
          });

          if (bot.strategy.kind === "protect") {
            const held = await walletBalance(config, bot, addressRef.current);
            useAppStore.getState().patchRuntime(bot.id, {
              ...(held !== undefined ? { heldBase: held.toString() } : {}),
              // A watch armed without a fixed reference anchors on the first
              // price it sees, so both targets stay put from then on.
              ...(bot.strategy.referencePrice <= 0 && !bot.runtime.refPrice
                ? { refPrice: price }
                : {}),
              ...(held === 0n ? { note: tRef.current("reason.protectEmpty") } : {}),
            });
          }

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

          // A dispatch interrupted mid-signature (tab closed, wallet dismissed
          // without an error) leaves the entry parked in a stage nothing
          // evaluates. With no signal left open, hand it back to where it was.
          const stalled = isStaged(current.strategy) && !current.runtime.completed
            ? current.runtime.stage === "entering"
              ? "waiting"
              : current.runtime.stage === "exiting"
                ? "holding"
                : undefined
            : undefined;
          if (stalled) {
            useAppStore.getState().patchRuntime(bot.id, { stage: stalled });
            continue;
          }

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
          if (!signal) continue;

          // Depth and price impact cannot be read off the price, so a snipe
          // asks the pool itself one last time before it commits.
          if (current.strategy.kind === "snipe" && intent.leg === "entry") {
            const depth = await snipeGate(client, current, BigInt(signal.amountIn));
            if (!depth.ok) {
              const message = tRef.current(depth.reason.key, depth.reason.vars);
              useAppStore.getState().patchRuntime(bot.id, {
                error: depth.waiting ? undefined : message,
                note: depth.waiting ? message : undefined,
              });
              continue;
            }
          }

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
