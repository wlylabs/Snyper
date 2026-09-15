import { isAddress } from "viem";
import { CHAIN_META, CHAIN_ID } from "./chains";

/**
 * Where a wallet's holdings come from when the chain is not asked one token at
 * a time.
 *
 * Reading balances with `balanceOf` answers one question perfectly — how much
 * of *this* token does the address hold — and cannot answer the one a reader
 * actually asks, which is what they hold at all. Nothing on chain indexes that:
 * finding it means walking the transfer log, which is what the wallet scan in
 * this app does, and which no popular wallet does, because it is slow and the
 * window is always too short.
 *
 * Every wallet worth comparing against — MetaMask, Rabby, Trust — answers it
 * the same way instead: an indexer that already walked the whole chain. This
 * chain has one, first party and public, in the Blockscout instance its own
 * explorer runs on. So the holdings list is asked of that, and the chain itself
 * stays the authority for everything the app is about to sign against.
 *
 * Nothing here is load bearing. An indexer that is down, rate limited, blocked
 * by the reader's network or challenged by its own front door answers with
 * nothing, and the caller falls back to reading the chain directly.
 */

/** Base URL of the Blockscout instance, or nothing when it is turned off. */
export function indexerBase(): string | undefined {
  const override = process.env.NEXT_PUBLIC_BLOCKSCOUT_4663?.trim();
  if (override?.toLowerCase() === "off") return undefined;
  const base = override || CHAIN_META[CHAIN_ID]?.explorer;
  return base ? base.replace(/\/+$/, "") : undefined;
}

const TIMEOUT = 8000;

/**
 * The wire shape, which is also what the same-origin fallback route returns.
 * Balances are strings rather than bigints because this crosses JSON, and a
 * balance is exactly the kind of number that loses its tail in a double.
 */
export type IndexedPayload = {
  native: string;
  tokens: {
    address: `0x${string}`;
    symbol: string;
    name: string;
    decimals: number;
    balance: string;
    /** USD per token, when the indexer carries market data for it. */
    priceUsd?: number;
  }[];
};

export type IndexedToken = Omit<IndexedPayload["tokens"][number], "balance"> & {
  balance: bigint;
};

export type IndexedPortfolio = {
  native: bigint;
  tokens: IndexedToken[];
};

type RawTokenBalance = {
  value?: string;
  token?: {
    address?: string;
    address_hash?: string;
    symbol?: string | null;
    name?: string | null;
    decimals?: string | number | null;
    type?: string | null;
    exchange_rate?: string | null;
  } | null;
};

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`indexer answered ${response.status}`);
  return response.json();
}

/** A balance the indexer reported, or nothing if it did not report one. */
function amount(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function price(rate: string | null | undefined): number | undefined {
  if (!rate) return undefined;
  const parsed = Number(rate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Turns one row of the indexer's answer into a token, or drops it.
 *
 * Only ERC-20s survive: an NFT is a holding too, and not one this terminal has
 * anywhere to put. Decimals are required rather than defaulted, because a token
 * shown at the wrong scale is a worse answer than a token not shown at all.
 */
function toToken(row: RawTokenBalance): IndexedPayload["tokens"][number] | undefined {
  const token = row.token;
  if (!token) return undefined;
  if (token.type && token.type.toUpperCase() !== "ERC-20") return undefined;

  const address = token.address ?? token.address_hash;
  if (!address || !isAddress(address)) return undefined;

  /*
   * Absent decimals are not zero decimals. `Number(null)` is 0, which would
   * pass every range check below and put a token on screen at 1:1 scale — a
   * wrong number presented with the same confidence as a right one, on the
   * page whose whole job is being comparable to the reader's wallet.
   */
  const scale = token.decimals;
  if (scale === null || scale === undefined || scale === "") return undefined;
  const decimals = Number(scale);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return undefined;

  const balance = amount(row.value);
  if (balance === undefined) return undefined;

  return {
    address: address as `0x${string}`,
    symbol: token.symbol?.trim() || "???",
    name: token.name?.trim() || address,
    decimals,
    balance: balance.toString(),
    ...(price(token.exchange_rate) !== undefined
      ? { priceUsd: price(token.exchange_rate) }
      : {}),
  };
}

/**
 * Asks the indexer what an address holds. Both halves are asked at once and
 * each is allowed to fail on its own: an address with a coin balance and an
 * unreadable token list is still worth reporting, and so is the reverse.
 */
export async function readIndexedPayload(
  address: `0x${string}`,
  base = indexerBase(),
): Promise<IndexedPayload | undefined> {
  if (!base) return undefined;

  const [coin, balances] = await Promise.all([
    getJson(`${base}/api/v2/addresses/${address}`).catch(() => undefined),
    getJson(`${base}/api/v2/addresses/${address}/token-balances`).catch(() => undefined),
  ]);

  if (coin === undefined && balances === undefined) return undefined;

  const native =
    amount((coin as { coin_balance?: string } | undefined)?.coin_balance)?.toString() ??
    "0";

  const rows = Array.isArray(balances) ? (balances as RawTokenBalance[]) : [];
  const tokens: IndexedPayload["tokens"] = [];
  for (const row of rows) {
    const token = toToken(row);
    if (token) tokens.push(token);
  }

  return { native, tokens };
}

/** The wire shape as the app uses it, with balances back in whole integers. */
export function parsePayload(payload: IndexedPayload): IndexedPortfolio {
  return {
    native: amount(payload.native) ?? 0n,
    tokens: payload.tokens.flatMap((token) => {
      const balance = amount(token.balance);
      return balance === undefined ? [] : [{ ...token, balance }];
    }),
  };
}

/**
 * The holdings list, asked of the indexer directly and then, if that did not
 * work, of this app's own origin.
 *
 * Two routes because the two fail in different places. A browser call is the
 * one that usually works — it is a real reader on a real network, which is what
 * a public explorer's front door is built to let through — but it needs the
 * indexer to allow this origin. The same-origin route has no such problem and
 * fails the other way instead, since a deployment's server calls arrive from a
 * data centre. Trying both costs one extra request on the path that was already
 * failing, and covers a reader whichever way it broke.
 */
export async function readIndexedPortfolio(
  address: `0x${string}`,
): Promise<IndexedPortfolio | undefined> {
  const direct = await readIndexedPayload(address).catch(() => undefined);
  if (direct) return parsePayload(direct);

  if (!indexerBase()) return undefined;

  try {
    const relayed = (await getJson(`/api/balances/${address}`)) as IndexedPayload;
    if (!relayed || !Array.isArray(relayed.tokens)) return undefined;
    return parsePayload(relayed);
  } catch {
    return undefined;
  }
}
