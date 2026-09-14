"use client";

import { useCallback, useState } from "react";
import { useAccount, useConfig, useWriteContract } from "wagmi";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { erc20Abi } from "@/lib/abi";
import { chainMeta, explorerTx } from "@/lib/chains";
import type { Quote } from "@/lib/quote";
import { applySlippage, buildSwap, swapRequest } from "@/lib/swap";
import type { Token } from "@/lib/tokens";
import { useToast } from "@/components/ui/Toast";
import { useAppStore } from "@/store/useAppStore";

export type ExecuteArgs = {
  tokenIn: Token;
  tokenOut: Token;
  amountIn: bigint;
  quote: Quote;
  slippageBps: number;
  deadlineMinutes: number;
  source: "terminal" | "bot";
  botName?: string;
};

export type ExecutePhase = "idle" | "approving" | "signing" | "pending";

export function useExecutor() {
  const { address, chainId } = useAccount();
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const pushTrade = useAppStore((state) => state.pushTrade);
  const updateTrade = useAppStore((state) => state.updateTrade);
  const toast = useToast();
  const [phase, setPhase] = useState<ExecutePhase>("idle");

  const execute = useCallback(
    async (args: ExecuteArgs): Promise<`0x${string}`> => {
      const { tokenIn, tokenOut, amountIn, quote, slippageBps, deadlineMinutes } = args;
      if (!address) throw new Error("Wallet not connected");
      const meta = chainMeta(tokenIn.chainId);
      if (!meta) throw new Error("Unsupported chain");
      if (chainId !== tokenIn.chainId) {
        throw new Error(`Switch the wallet to ${meta.label} first`);
      }

      const amountOutMinimum = applySlippage(quote.amountOut, slippageBps);

      // ERC-20 inputs need a router allowance before the swap can settle.
      if (!tokenIn.native) {
        setPhase("approving");
        const allowance = (await readContract(config, {
          address: tokenIn.address,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address, meta.router],
          chainId: tokenIn.chainId,
        })) as bigint;

        if (allowance < amountIn) {
          const approveHash = await writeContractAsync({
            address: tokenIn.address,
            abi: erc20Abi,
            functionName: "approve",
            args: [meta.router, amountIn],
            chainId: tokenIn.chainId,
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
            botName: args.botName,
          });
          toast.push({
            tone: "info",
            message: `Approving ${tokenIn.symbol}`,
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
          if (receipt.status !== "success") throw new Error("Approval reverted");
        }
      }

      setPhase("signing");
      const plan = buildSwap({
        tokenIn,
        tokenOut,
        amountIn,
        amountOutMinimum,
        fee: quote.fee,
        recipient: address,
        deadlineMinutes,
      });

      const request = swapRequest(plan);
      const hash = await writeContractAsync({
        address: request.address,
        abi: request.abi,
        functionName: request.functionName,
        args: request.args,
        value: request.value,
        chainId: tokenIn.chainId,
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
        botName: args.botName,
      });
      toast.push({
        tone: "info",
        message: `Swap submitted · ${tokenIn.symbol} → ${tokenOut.symbol}`,
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
        message: ok ? "Swap confirmed" : "Swap reverted",
        detail: hash,
        href: explorerTx(tokenIn.chainId, hash),
      });
      setPhase("idle");
      if (!ok) throw new Error("Swap reverted");
      return hash;
    },
    [address, chainId, config, pushTrade, toast, updateTrade, writeContractAsync],
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

export function readableError(error: unknown): string {
  if (!error) return "Unknown error";
  const message = error instanceof Error ? error.message : String(error);
  if (/User rejected|denied transaction|rejected the request/i.test(message)) {
    return "Rejected in wallet";
  }
  if (/insufficient funds/i.test(message)) return "Insufficient balance for gas";
  if (/STF|TRANSFER_FROM_FAILED/i.test(message)) return "Token transfer failed";
  if (/Too little received|slippage/i.test(message)) return "Slippage exceeded";
  return message.split("\n")[0].slice(0, 180);
}
