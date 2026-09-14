"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient, readContract } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi";
import { quoteExactIn } from "@/lib/quote";
import type { Token } from "@/lib/tokens";
import type { Signal } from "@/lib/types";
import { todayKey, useAppStore } from "@/store/useAppStore";
import { readableError, useExecutor } from "./useExecutor";
import { useI18n } from "./useI18n";

/**
 * Wallet balance of an ERC-20, used to measure what a swap actually delivered.
 * Native balances are deliberately not read: gas leaves the same account in the
 * same transaction, so a delta there would measure the fee as well as the fill.
 */
async function heldBalance(
  config: ReturnType<typeof useConfig>,
  token: Token,
  owner: `0x${string}` | undefined,
): Promise<bigint | undefined> {
  if (!owner || token.native) return undefined;
  try {
    return (await readContract(config, {
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner],
      chainId: token.chainId,
    })) as bigint;
  } catch {
    return undefined;
  }
}

/**
 * Turns a strategy signal into a wallet transaction and folds the result back
 * into the bot's runtime. Shared by the headless engine and the manual queue.
 */
export function useDispatchSignal() {
  const config = useConfig();
  const { address } = useAccount();
  const { execute } = useExecutor();
  const { t } = useI18n();

  return useCallback(
    async (signal: Signal) => {
      const store = useAppStore.getState();
      const bot = store.bots.find((item) => item.id === signal.botId);
      if (!bot) return;

      const client = getPublicClient(config, { chainId: signal.chainId });
      if (!client) return;

      const isOrder = bot.strategy.kind === "order";
      const closingOrder = isOrder && signal.side === "sell";
      let amountIn = BigInt(signal.amountIn);

      // A full exit sells what the wallet is holding right now, not what the
      // entry once received: anything sold elsewhere in between would otherwise
      // make the swap revert on a balance that is no longer there.
      if (closingOrder) {
        const held = await heldBalance(config, signal.tokenIn, address);
        if (held !== undefined && held < amountIn) {
          if (held <= 0n) {
            store.updateSignal(signal.id, { status: "cancelled" });
            useAppStore.getState().patchRuntime(bot.id, {
              stage: "done",
              exitReason: "manual",
              positionBase: "0",
              completed: true,
              error: t("error.positionGone"),
            });
            useAppStore.getState().setBotStatus(bot.id, "idle");
            return;
          }
          amountIn = held;
          store.updateSignal(signal.id, { amountIn: held.toString() });
        }
      }

      store.updateSignal(signal.id, { status: "executing", error: undefined });
      if (isOrder) {
        store.patchRuntime(bot.id, { stage: closingOrder ? "exiting" : "entering" });
      }

      try {
        const quote = await quoteExactIn(client, signal.tokenIn, signal.tokenOut, amountIn);
        if (!quote) throw new Error(t("error.noRoute"));

        // Read before the swap so the delta afterwards is the real fill, taxes
        // and price impact included.
        const balanceBefore =
          isOrder && !closingOrder
            ? await heldBalance(config, signal.tokenOut, address)
            : undefined;

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

        if (isOrder && !closingOrder) {
          const balanceAfter = await heldBalance(config, signal.tokenOut, address);
          const received =
            balanceBefore !== undefined &&
            balanceAfter !== undefined &&
            balanceAfter > balanceBefore
              ? balanceAfter - balanceBefore
              : quote.amountOut;
          const receivedSize = Number(received) / 10 ** signal.tokenOut.decimals;

          // Take profit and cut loss hang off what was actually paid, so a leg
          // that slipped moves both targets with it.
          useAppStore.getState().patchRuntime(bot.id, {
            stage: "holding",
            fillPrice: receivedSize > 0 ? sizeIn / receivedSize : signal.price,
            positionBase: received.toString(),
          });
        }

        if (closingOrder) {
          useAppStore.getState().patchRuntime(bot.id, {
            stage: "done",
            exitReason: signal.leg === "tp" || signal.leg === "cl" ? signal.leg : "manual",
            positionBase: "0",
            completed: true,
          });
          useAppStore.getState().setBotStatus(bot.id, "idle");
        }

        if (oneShot) useAppStore.getState().setBotStatus(bot.id, "idle");
        useAppStore.getState().updateSignal(signal.id, { status: "confirmed", hash });
      } catch (error) {
        const message = readableError(error, t);
        useAppStore.getState().updateSignal(signal.id, { status: "failed", error: message });
        useAppStore.getState().patchRuntime(bot.id, {
          error: message,
          // Hand the order back to the stage it came from so the next tick can
          // try again — a failed exit especially must not leave it stranded.
          ...(isOrder ? { stage: closingOrder ? ("holding" as const) : ("waiting" as const) } : {}),
        });
      }
    },
    [address, config, execute, t],
  );
}
