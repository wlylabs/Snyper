"use client";

import { useCallback } from "react";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient, readContract } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi";
import { feeChargeable, profitFeeBps } from "@/lib/fees";
import { quoteExactIn } from "@/lib/quote";
import type { Token } from "@/lib/tokens";
import type { Signal, Snype } from "@/lib/types";
import { useAppStore } from "@/store/useAppStore";
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
 * Quote units a snype's entry paid for the position it is now holding.
 *
 * A snype that filled before cost basis was recorded has none, and reads as
 * zero — which is what stops it being charged rather than charged on a basis
 * that was guessed.
 */
function costBasis(snype: Snype): bigint {
  try {
    return BigInt(snype.runtime.costQuote ?? "0");
  } catch {
    return 0n;
  }
}

/**
 * Turns a snype signal into a wallet transaction and folds the result back into
 * the snype's runtime. Shared by the headless runner and the manual queue.
 */
export function useDispatchSignal() {
  const config = useConfig();
  const { address } = useAccount();
  const { execute } = useExecutor();
  const { t } = useI18n();

  return useCallback(
    async (signal: Signal) => {
      const store = useAppStore.getState();
      const snype = store.snypes.find((item) => item.id === signal.snypeId);
      if (!snype) return;

      const client = getPublicClient(config, { chainId: signal.chainId });
      if (!client) return;

      const closingPosition = signal.side === "sell";
      let amountIn = BigInt(signal.amountIn);

      // A full exit sells what the wallet is holding right now, not what the
      // entry once received: anything sold elsewhere in between would otherwise
      // make the swap revert on a balance that is no longer there.
      if (closingPosition) {
        const held = await heldBalance(config, signal.tokenIn, address);
        if (held !== undefined && held < amountIn) {
          if (held <= 0n) {
            store.updateSignal(signal.id, { status: "cancelled" });
            useAppStore.getState().patchRuntime(snype.id, {
              stage: "done",
              exitReason: "manual",
              positionBase: "0",
              completed: true,
              error: t("error.positionGone"),
            });
            useAppStore.getState().setSnypeStatus(snype.id, "idle");
            return;
          }
          amountIn = held;
          store.updateSignal(signal.id, { amountIn: held.toString() });
        }
      }

      store.updateSignal(signal.id, { status: "executing", error: undefined });
      store.patchRuntime(snype.id, { stage: closingPosition ? "exiting" : "entering" });

      try {
        const quote = await quoteExactIn(client, signal.tokenIn, signal.tokenOut, amountIn);
        if (!quote) throw new Error(t("error.noRoute"));

        // Read before the swap so the delta afterwards is the real fill, taxes
        // and price impact included.
        const balanceBefore = closingPosition
          ? undefined
          : await heldBalance(config, signal.tokenOut, address);

        /*
         * What the exit owes, worked out before it is signed.
         *
         * A snype is charged on the way out and only on what it made: the
         * entry's own cost basis against what this sale returns, with a loss
         * costing nothing. An entry is never charged, so the fee below is zero
         * on every leg but a profitable exit — and zero as well on a curve,
         * which has nowhere to put one.
         *
         * An exit cut down to what the wallet still holds is measured against
         * the whole entry all the same, which understates the profit and so
         * undercharges it. That is the right way for it to be wrong.
         */
        const feeBps =
          closingPosition && feeChargeable(quote.venue)
            ? profitFeeBps({ grossOut: quote.amountOut, costBasis: costBasis(snype) })
            : 0;

        const hash = await execute({
          tokenIn: signal.tokenIn,
          tokenOut: signal.tokenOut,
          amountIn,
          quote,
          slippageBps: snype.slippageBps,
          deadlineMinutes: store.settings.deadlineMinutes,
          source: "snype",
          snypeName: snype.name,
          feeBps,
          // Funded in the quote currency, so charged in it too: on the way in
          // that is the input, on the way out it is the output.
          feeOnInput: !closingPosition,
        });

        // A bonding-curve buy that clears the last of the sellable supply is
        // filled short and refunded the rest, so the spend — and every figure
        // derived from it — is what the venue actually took, not what was sent.
        const spent = amountIn - (quote.refund ?? 0n);
        const sizeIn = Number(spent) / 10 ** signal.tokenIn.decimals;
        const current = useAppStore.getState().snypes.find((item) => item.id === snype.id) ?? snype;

        useAppStore.getState().patchRuntime(snype.id, {
          lastFireAt: Date.now(),
          fills: current.runtime.fills + 1,
          error: undefined,
        });

        if (!closingPosition) {
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
          useAppStore.getState().patchRuntime(snype.id, {
            stage: "holding",
            fillPrice: receivedSize > 0 ? sizeIn / receivedSize : signal.price,
            positionBase: received.toString(),
            // The cost basis the exit will be measured against: what the venue
            // took, not what was sent, so a curve buy that was refunded part of
            // its spend is not charged on the refund.
            costQuote: spent.toString(),
          });
        } else {
          useAppStore.getState().patchRuntime(snype.id, {
            stage: "done",
            exitReason: signal.leg === "tp" || signal.leg === "cl" ? signal.leg : "manual",
            positionBase: "0",
            completed: true,
          });
          useAppStore.getState().setSnypeStatus(snype.id, "idle");
        }

        useAppStore.getState().updateSignal(signal.id, { status: "confirmed", hash });
      } catch (error) {
        const message = readableError(error, t);
        useAppStore.getState().updateSignal(signal.id, { status: "failed", error: message });
        useAppStore.getState().patchRuntime(snype.id, {
          error: message,
          // Hand the entry back to the stage it came from so the next tick can
          // try again — a failed exit especially must not leave it stranded.
          stage: closingPosition ? "holding" : "waiting",
        });
      }
    },
    [address, config, execute, t],
  );
}
