"use client";

import { useAccount, useBalance, useReadContract } from "wagmi";
import { erc20Abi } from "@/lib/abi";
import type { Token } from "@/lib/tokens";

export function useTokenBalance(token?: Token) {
  const { address } = useAccount();

  const native = useBalance({
    address,
    chainId: token?.chainId,
    query: { enabled: Boolean(address && token?.native), refetchInterval: 20_000 },
  });

  const erc20 = useReadContract({
    address: token && !token.native ? token.address : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: token?.chainId,
    query: {
      enabled: Boolean(address && token && !token.native),
      refetchInterval: 20_000,
    },
  });

  const value = token?.native ? native.data?.value : (erc20.data as bigint | undefined);
  const refetch = token?.native ? native.refetch : erc20.refetch;

  return { value, refetch, isLoading: token?.native ? native.isLoading : erc20.isLoading };
}
