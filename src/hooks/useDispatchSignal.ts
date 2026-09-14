"use client";

import { useCallback } from "react";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { quoteExactIn } from "@/lib/quote";
import type { Signal } from "@/lib/types";
import { todayKey, useAppStore } from "@/store/useAppStore";
import { readableError, useExecutor } from "./useExecutor";
import { useI18n } from "./useI18n";

/**
 * Turns a strategy signal into a wallet transaction and folds the result back
 * into the bot's runtime. Shared by the headless engine and the manual queue.
 */
export function useDispatchSignal() {
  const config = useConfig();
  const { execute } = useExecutor();
  const { t } = useI18n();

  return useCallback(
    async (signal: Signal) => {
      const store = useAppStore.getState();
      const bot = store.bots.find((item) => item.id === signal.botId);
      if (!bot) return;

      const client = getPublicClient(config, { chainId: signal.chainId });
      if (!client) return;

      store.updateSignal(signal.id, { status: "executing", error: undefined });

      try {
        const amountIn = BigInt(signal.amountIn);
        const quote = await quoteExactIn(client, signal.tokenIn, signal.tokenOut, amountIn);
        if (!quote) throw new Error(t("error.noRoute"));

        const hash = await execute({
          tokenIn: signal.tokenIn,
          tokenOut: signal.tokenOut,
          amountIn,
          quote,
          slippageBps: bot.slippageBps,
          deadlineMinutes: store.settings.deadlineMinutes,
          source: "bot",
          botName: bot.name,
        });

        const sizeIn = Number(amountIn) / 10 ** signal.tokenIn.decimals;
        const notional = signal.side === "buy" ? sizeIn : sizeIn * signal.price;
        const today = todayKey();
        const current = useAppStore.getState().bots.find((item) => item.id === bot.id) ?? bot;
        const previousSpend = current.runtime.spentDate === today ? current.runtime.spentQuote : 0;

        const filled = new Set(current.runtime.filledLevels);
        if (signal.level !== undefined) {
          if (signal.side === "buy") filled.add(signal.level);
          else filled.delete(signal.level);
        }

        const oneShot = current.strategy.kind === "limit" || current.strategy.kind === "trail";

        useAppStore.getState().patchRuntime(bot.id, {
          lastFireAt: Date.now(),
          fills: current.runtime.fills + 1,
          spentDate: today,
          spentQuote: previousSpend + notional,
          deployedQuote:
            signal.side === "buy"
              ? current.runtime.deployedQuote + notional
              : current.runtime.deployedQuote,
          filledLevels: [...filled],
          completed: oneShot ? true : current.runtime.completed,
          error: undefined,
        });

        if (oneShot) useAppStore.getState().setBotStatus(bot.id, "idle");
        useAppStore.getState().updateSignal(signal.id, { status: "confirmed", hash });
      } catch (error) {
        const message = readableError(error, t);
        useAppStore.getState().updateSignal(signal.id, { status: "failed", error: message });
        useAppStore.getState().patchRuntime(bot.id, { error: message });
      }
    },
    [config, execute, t],
  );
}
