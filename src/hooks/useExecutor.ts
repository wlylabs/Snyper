"use client";

import { useCallback, useState } from "react";
import { parseGwei } from "viem";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { getPublicClient, readContract, waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi";
import { chainMeta, explorerTx } from "@/lib/chains";
import type { Quote } from "@/lib/quote";
import { formatPercent } from "@/lib/format";
import { applySlippage, buildSwap, swapRequest } from "@/lib/swap";
import type { Token } from "@/lib/tokens";
import { useToast } from "@/components/ui/Toast";
import { useAppStore } from "@/store/useAppStore";
import { useI18n } from "@/hooks/useI18n";
import type { TKey, TVars } from "@/lib/i18n";

export type ExecuteArgs = {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  quote: Quote;
  slippageBps: number;
  deadlineMinutes: number;
  source: "terminal" | "snype";
  snypeName?: string;
};

export type ExecutePhase = "idle" | "approving" | "signing" | "pending";

export type FeeOverrides = {
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

/**
 * Turns the configured tip into a full 1559 pair. Wallets reject a priority fee
 * sent without a ceiling to sit under, so the base fee of the latest block is
 * doubled to leave room for it. A chain with no base fee is left to the wallet.
 */
async function feeOverrides(
  config: ReturnType<typeof useConfig>,
  chainId: number,
  priorityFeeGwei: number,
): Promise<FeeOverrides> {
  if (!(priorityFeeGwei > 0)) return {};
  try {
    const client = getPublicClient(config, { chainId });
    if (!client) return {};
    const block = await client.getBlock({ blockTag: "latest" });
    const base = block.baseFeePerGas;
    if (base === null || base === undefined) return {};
    const tip = parseGwei(priorityFeeGwei.toString());
    return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
  } catch {
    // A fee read that fails is not worth failing the trade over.
    return {};
  }
}

export function useExecutor() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const pushTrade = useAppStore((state) => state.pushTrade);
  const updateTrade = useAppStore((state) => state.updateTrade);
  const priorityFeeGwei = useAppStore((state) => state.settings.priorityFeeGwei);
  const maxImpactBps = useAppStore((state) => state.settings.maxImpactBps);
  const toast = useToast();
  const { t } = useI18n();
  const [phase, setPhase] = useState<ExecutePhase>("idle");

  const execute = useCallback(
    async (args: ExecuteArgs): Promise<`0x${string}`> => {
      const { tokenIn, tokenOut, amountIn, quote, slippageBps, deadlineMinutes } = args;
      if (!address) throw new Error(t("error.notConnected"));
      const meta = chainMeta(tokenIn.chainId);
      if (!meta) throw new Error(t("error.unsupportedChain"));
      if (chainId !== tokenIn.chainId) {
        throw new Error(t("error.switchFirst", { chain: meta.label }));
      }

      // The depth guard stands in front of every route the app can take, manual
      // or automated. A pool that has been drained prices a trade at a loss long
      // before the slippage bound on the swap itself would catch it.
      const impactLimit = maxImpactBps > 0 ? maxImpactBps / 10_000 : undefined;
      if (impactLimit !== undefined && quote.priceImpact > impactLimit) {
        throw new Error(
          t("error.impactGuard", {
            impact: formatPercent(quote.priceImpact),
            limit: formatPercent(impactLimit),
          }),
        );
      }

      const amountOutMinimum = applySlippage(quote.amountOut, slippageBps);
      const fees = await feeOverrides(config, tokenIn.chainId, priorityFeeGwei);

      // Built before the approval so the spender is the contract that will
      // actually pull the tokens: SwapRouter02 on a pool route, the bonding
      // curve itself on a launchpad one.
      const plan = buildSwap({
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMinimum,
        quote,
        recipient: address,
        deadlineMinutes,
      });

      // ERC-20 inputs need an allowance before the trade can settle.
      if (!tokenIn.native) {
        setPhase("approving");
        const allowance = (await readContract(config, {
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, plan.target],
          chainId: tokenIn.chainId,
        })) as bigint;

        if (allowance < amountIn) {
          const approveHash = await writeContractAsync({
            address: tokenIn.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [plan.target, amountIn],
            chainId: tokenIn.chainId,
            ...fees,
          });
          pushTrade({
            id: approveHash,
            kind: "approval",
            chainId: tokenIn.chainId,
            createdAt: Date.now(),
            hash: approveHash,
            status: "submitted",
            source: args.source,
            tokenIn,
            amountIn: amountIn.toString(),
            snypeName: args.snypeName,
          });
          toast.push({
            tone: "info",
            message: t("toast.approving", { symbol: tokenIn.symbol }),
            detail: approveHash,
            href: explorerTx(tokenIn.chainId, approveHash),
          });
          const receipt = await waitForTransactionReceipt(config, {
            hash: approveHash,
            chainId: tokenIn.chainId,
          });
          updateTrade(approveHash, {
            status: receipt.status === "success" ? "confirmed" : "failed",
          });
          if (receipt.status !== "success") throw new Error(t("error.approvalReverted"));
        }
      }

      setPhase("signing");
      const request = swapRequest(plan);
      const hash = await writeContractAsync({
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
        chainId: tokenIn.chainId,
        ...fees,
      });

      pushTrade({
        id: hash,
        kind: "swap",
        chainId: tokenIn.chainId,
        createdAt: Date.now(),
        hash,
        status: "submitted",
        source: args.source,
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        amountOut: quote.amountOut.toString(),
        snypeName: args.snypeName,
      });
      toast.push({
        tone: "info",
        message: t("toast.swapSubmitted", { from: tokenIn.symbol, to: tokenOut.symbol }),
        detail: hash,
        href: explorerTx(tokenIn.chainId, hash),
      });

      setPhase("pending");
      const receipt = await waitForTransactionReceipt(config, {
        hash,
        chainId: tokenIn.chainId,
      });
      const ok = receipt.status === "success";
      updateTrade(hash, { status: ok ? "confirmed" : "failed" });
      toast.push({
        tone: ok ? "ok" : "error",
        message: ok ? t("toast.swapConfirmed") : t("toast.swapReverted"),
        detail: hash,
        href: explorerTx(tokenIn.chainId, hash),
      });
      setPhase("idle");
      if (!ok) throw new Error(t("error.swapReverted"));
      return hash;
    },
    [
      address,
      chainId,
      config,
      maxImpactBps,
      priorityFeeGwei,
      pushTrade,
      t,
      toast,
      updateTrade,
      writeContractAsync,
    ],
  );

  const run = useCallback(
    async (args: ExecuteArgs) => {
      try {
        return await execute(args);
      } finally {
        setPhase("idle");
      }
    },
    [execute],
  );

  return { execute: run, phase };
}

type Translate = (key: TKey, vars?: TVars) => string;

/** Maps the noisy wallet and RPC failures onto phrases a reader can act on. */
export function readableError(error: unknown, t: Translate): string {
  if (!error) return t("error.unknown");
  const message = error instanceof Error ? error.message : String(error);
  if (/User rejected|denied transaction|rejected the request/i.test(message)) {
    return t("error.rejected");
  }
  if (/insufficient funds/i.test(message)) return t("error.insufficientGas");
  if (/STF|TRANSFER_FROM_FAILED/i.test(message)) return t("error.transferFailed");
  if (/Too little received|SlippageExceeded|slippage/i.test(message)) {
    return t("error.slippage");
  }
  // A curve closes the moment its sellable supply runs out, which is a race
  // anyone buying near graduation can lose.
  if (/CurveGraduated/i.test(message)) return t("error.curveGraduated");
  return message.split("\n")[0].slice(0, 180);
}
