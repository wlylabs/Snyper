"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatEther, formatUnits, isAddress, parseUnits } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { Figure } from "@/components/ui/Figure";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, chainMeta, explorerTx } from "@/lib/chains";
import { haptic } from "@/lib/haptics";
import { formatAmount, formatCompact } from "@/lib/format";
import { shareOf, verdictOf, type Lock, type Verdict } from "@/lib/lock";
import { clearsFloor, dropCopycats, underCeiling } from "@/lib/screener";
import { signalOf } from "@/lib/signal";
import {
  EXITS,
  FEE_BIPS,
  SLIPPAGE_FLOOR,
  SNIPE_CEILING,
  VENUE,
  afterFee,
  floorFor,
  slippageCapped,
  snipeSlippageFor,
} from "@/lib/venue";
import { useAimByAddress } from "@/hooks/useAimByAddress";
import { useCoinUsd } from "@/hooks/useCoinUsd";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useI18n } from "@/hooks/useI18n";
import { useLiquidityLock } from "@/hooks/useLiquidityLock";
import { useMounted } from "@/hooks/useMounted";
import { useScreener, type Pair } from "@/hooks/useScreener";
import { STAKES, stakeIn, useFire, useShot } from "@/hooks/useSnipe";
import { useRoutes, useSwapAction } from "@/hooks/useSwap";
import { useTargetDetail } from "@/hooks/useTargetDetail";
import { basisKey, useAppStore } from "@/store/useAppStore";
import type { TKey } from "@/lib/i18n";

/**
 * The page's own width, and how it splits.
 *
 * One column up to `lg`, which is the phone and the tablet and is the shape
 * the whole screen was built in. Above that the page widens and the targets
 * take a column of their own: a 768px strip down the centre of a 1440px
 * monitor is the layout every dapp has, and it spends the two thirds of the
 * screen it does not use on nothing.
 *
 * The strip is fixed rather than fractional so the terminal beside it keeps
 * the measure it was written for instead of growing with the window — the
 * rows in it are label-and-figure pairs, and past about 700px they stop being
 * rows and become a label and a figure at opposite ends of a gap.
 */
const SHELL = "mx-auto w-full max-w-3xl lg:max-w-[1160px]";
const SPLIT = "lg:grid lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-3";

/** Where the rest of the market is already looking at a pair. */
const DEXSCREENER = "https://dexscreener.com/robinhood";

/**
 * What the wallet keeps back for gas when the reader asks for everything.
 *
 * A buy on this chain costs a few cents of gas, and gas comes out of the same
 * balance the stake does — so "all of it" has to mean all but enough to pay for
 * the sending. A quarter of a dollar is many times the real cost and still
 * small enough that nobody feels it withheld.
 */
const RESERVE = 0.25;

/**
 * The number after the reader has stopped typing.
 *
 * Every quote is a call to the chain, and a pool moves with the size of the
 * trade, so a figure cannot be scaled from some other figure — it has to be
 * asked for. Quoting each keystroke would be right and unaffordable; this waits
 * for the number to stand still first.
 */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * Where a fill stops being cheap and starts being a decision.
 *
 * Nothing refuses at this line — five percent is an ordinary price for an
 * ordinary memecoin pool, and a screen that blocked it would be a sniper that
 * cannot shoot. It is where the cost stops being a row among rows and gets said
 * out loud, with the number in it.
 */
const COSTLY = 500;

/**
 * How long the trigger ignores a second tap, in milliseconds.
 *
 * Long enough to outlast the render that disables the button, short enough that
 * a reader who meant to fire twice is never told no.
 */
const LATCH = 1200;

/**
 * Basis points as a percent, for a label. 50 reads as 0.5, or 0,5.
 *
 * Through the app's own formatter rather than `String`, so the separator is the
 * reader's. An Indonesian screen printing 135.873,41 MEOWTON beside 0.04% is
 * using two conventions in one panel, and the one it borrowed is not theirs.
 */
function percent(bps: number): string {
  return formatAmount(bps / 100);
}

/**
 * Always dollars, never the reader's chosen currency.
 *
 * The currency setting is the balance screen's — what the wallet holds is
 * money the reader keeps, and Rupiah is how they think about that. A quote
 * against a pool is a different kind of figure: it is denominated in the
 * chain's own unit before it is anything else, the stake ladder beside it is
 * priced in dollars, and converting one figure on this screen without the
 * other would leave a reader comparing a price in two currencies at once.
 */
function usd(value: number | undefined): string {
  return value === undefined ? "—" : `$${formatCompact(value)}`;
}

/** A signed dollar figure, for a profit and loss that has to show its sign. */
function signedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${formatCompact(Math.abs(value))}`;
}

/**
 * What the terminal will point at.
 *
 * The memecoin screen is a list to read and this is a list to shoot at, so the
 * bar is different: everything above the ceiling is somebody else's entry, and
 * everything that has not been shown to have a market — a floor's worth resting
 * in the pool and a floor's worth traded through it — is not a target, it is a
 * pool with a name.
 *
 * Coil first inside those limits, which is the memecoin screen's order and now
 * this one's. The two lists do not have to agree about what they hold and they
 * do have to agree about what goes at the top: a reader who found a row by its
 * coil on one screen and then walked to the other to fire was handed a list
 * sorted by volume, which puts what has already run above what they came for.
 * Volume still settles the rows the signal cannot separate.
 */
function targets(pairs: Pair[]): Pair[] {
  /*
   * The same names the memecoin screen refuses, refused here too.
   *
   * This list is not that one and does not have to agree with it about depth or
   * about what is worth showing — but a ticker held by several contracts is not
   * a matter of taste, and a screen that hides a copy while the screen that
   * fires still offers it has put the copy exactly where it does damage. The
   * floor above went through this once already, under three different standards
   * on three screens; there is no reason to learn it a second time.
   */
  return dropCopycats(pairs)
    .filter((pair) => underCeiling(pair) && clearsFloor(pair))
    .map((pair) => ({ pair, score: signalOf(pair).score }))
    .sort((a, b) => b.score - a.score || b.pair.volume - a.pair.volume)
    .map(({ pair }) => pair);
}

/** How much of a position is being sold, offered rather than typed. */
const SLICES = [25, 50, 100] as const;

/** A quote's output in the dollars it is worth, whichever side it came out on. */
function worth(
  amount: bigint,
  exit: (typeof EXITS)[number] | undefined,
  coinUsd: number | undefined,
): number | undefined {
  if (!exit) return undefined;
  const units = Number(formatUnits(amount, exit.decimals));
  if (exit.address.toLowerCase() === VENUE.stable.toLowerCase()) return units;
  return coinUsd === undefined ? undefined : units * coinUsd;
}

/**
 * Dollars as a measurement rounded down to the cent, rather than to nearest —
 * this is used for what a wallet can spend, and rounding up would offer a
 * figure the balance cannot cover.
 */
function floorCents(value: number): number {
  return Math.floor(value * 100) / 100;
}

/**
 * A target that never has to show up in anybody's list to be shot at.
 *
 * The venue's whole catalogue is contracts and fee tiers, not names, so any
 * token with a pool against one of this venue's two quote assets can be
 * priced the moment its address is known — see `useAimByAddress`, which asks
 * the factory rather than reading the swap window `useScreener` builds its
 * own list from. A token minutes old and untraded is exactly the case that
 * list cannot carry and this can: paste it, and it is the target.
 */
function AddressAim({ onAim }: { onAim: (pair: Pair) => void }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const trimmed = typed.trim();
  /* Checksum is not required — a paste in the wrong case is still the same
     address, and the chain reads take it exactly as typed either way. */
  const address = isAddress(trimmed, { strict: false }) ? (trimmed as `0x${string}`) : undefined;
  const { pair, resolving, notFound } = useAimByAddress(address);

  useEffect(() => {
    if (!pair) return;
    onAim(pair);
    setTyped("");
  }, [pair, onAim]);

  return (
    <div className="mb-1.5">
      <div className="tile">
        <Icon name="search" size={13} className="shrink-0 text-faint" />
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={t("snipe.pasteAddress")}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint"
        />
        {resolving && <Icon name="pulse" size={13} className="shrink-0 text-faint" />}
      </div>
      {typed.length > 0 && !address && (
        <p className="mt-1 px-1 text-[11px] text-faint">{t("snipe.pasteAddressHint")}</p>
      )}
      {notFound && <p className="mt-1 px-1 text-[11px] warn">{t("snipe.pasteAddressNotFound")}</p>}
    </div>
  );
}

/**
 * What there is to shoot at.
 *
 * Its own component because the same list is read in two places now: behind a
 * button on a phone, where there is only ever room for one thing at a time,
 * and beside the terminal on a wide screen, where there is room for both and
 * hiding it behind a button was the screen admitting it had nothing to put in
 * the space. One list, so a target reads the same whichever way it was found.
 */
function TargetList({
  pairs,
  loading,
  chosen,
  onPick,
}: {
  pairs: Pair[];
  loading: boolean;
  chosen: string | undefined;
  onPick: (pool: string) => void;
}) {
  const { t } = useI18n();

  if (loading && pairs.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4].map((row) => (
          <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
        ))}
      </div>
    );
  }

  if (pairs.length === 0) {
    return <Empty title={t("snipe.empty")} hint={t("snipe.emptyHint")} />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {pairs.map((pair) => (
        <button
          key={pair.pool}
          type="button"
          className="tile"
          aria-current={pair.pool === chosen}
          /* The row the shot is being quoted against is lit, not just marked
             for assistive technology. On the phone the list closes on the tap
             and there is nothing to light; pinned beside the terminal it stays
             open, and a list that does not say which row the panel is reading
             is a list the reader has to remember for. */
          data-active={pair.pool === chosen ? "true" : undefined}
          onClick={() => onPick(pair.pool)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate">
              {pair.symbol}
              <span className="font-normal text-faint">/{pair.quote}</span>
            </span>
            <span className="block truncate text-[11px] font-normal text-faint">
              <span className="lbl">{t("launches.liqShort")}</span>{" "}
              <Figure className="num" value={usd(pair.liquidity)} />
              {" · "}
              <span className="lbl">{t("launches.volShort")}</span>{" "}
              <Figure className="num" value={usd(pair.volume)} />
            </span>
          </span>
          <span className="shrink-0 text-right">
            <Figure className="num block text-[12px]" value={usd(pair.marketCap)} />
            <Figure
              className={`num block text-[11px] font-normal ${pair.change >= 0 ? "long" : "short"}`}
              value={`${pair.change >= 0 ? "+" : ""}${pair.change.toFixed(1)}%`}
            />
          </span>
        </button>
      ))}
    </div>
  );
}

function TargetSheet({
  open,
  pairs,
  loading,
  chosen,
  onPick,
  onAim,
  onClose,
}: {
  open: boolean;
  pairs: Pair[];
  loading: boolean;
  chosen: string | undefined;
  onPick: (pool: string) => void;
  onAim: (pair: Pair) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Sheet open={open} title={t("snipe.targets")} onClose={onClose}>
      <div className="p-3">
        <AddressAim
          onAim={(pair) => {
            onAim(pair);
            onClose();
          }}
        />
        <TargetList
          pairs={pairs}
          loading={loading}
          chosen={chosen}
          onPick={(pool) => {
            onPick(pool);
            onClose();
          }}
        />
      </div>
    </Sheet>
  );
}

function Notice({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="panel mt-2 flex items-start gap-3 p-3">
      <Icon name="alert" size={16} className="warn mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="warn text-[12px] font-semibold">{title}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-dim">{hint}</p>
      </div>
    </div>
  );
}

/**
 * How much of a pool has to be provably burned before this stops objecting.
 *
 * Half, and the number matters less than which side of it a reader is on. A
 * pool that is 5% burned and 95% withdrawable is an open pool wearing a badge,
 * and reporting it as `mixed` and saying nothing further would be this screen
 * doing the thing it exists to stop.
 */
const MOSTLY_BURNED = 50;

/**
 * What the lock reads as, in the two things this row prints.
 *
 * `unread` is deliberately the dull one — faint, no colour, no notice below it.
 * It is the commonest answer on this chain by some margin: eight of the
 * eighteen pools sampled in `lib/lock` were held by eight different contracts,
 * none of which can be read as a lock and several of which are wrappers rather
 * than locks. Painting all of those as a warning would put a red mark on most
 * of the market, and a warning that fires on most of the market is one readers
 * learn to scroll past — taking the ones that mean something with it.
 */
const LOCK_FACE: Record<Verdict, { icon: IconName; tone: string; hint: TKey }> = {
  burned: { icon: "check", tone: "long", hint: "snipe.lockBurnedHint" },
  mixed: { icon: "alert", tone: "warn", hint: "snipe.lockMixedHint" },
  open: { icon: "alert", tone: "short", hint: "snipe.lockOpenHint" },
  unread: { icon: "alert", tone: "text-faint", hint: "snipe.lockUnreadHint" },
  empty: { icon: "alert", tone: "short", hint: "snipe.lockEmptyHint" },
};

/**
 * Whether the pool will still be there, beside whether it can be sold into.
 *
 * The exit check next to this one runs the sale through the pool's own code and
 * reports what came back, which is the strongest thing any screen can say about
 * getting out — and it is a statement about this block. The commonest way a
 * memecoin buyer loses their money is not a token that cannot be sold; it is a
 * pool that was there when they bought and gone an hour later, and the two are
 * indistinguishable afterwards. One check answers for now and the other for
 * later, so they are read together or neither is worth much.
 *
 * `backsPrice` is carried because a burn can be bought cheaply. A v3 position
 * only holds the price up while the price is inside its range, so liquidity
 * burned in a range nobody trades in is un-withdrawable and also not under
 * anything. Reported as a green hundred percent, that is the same false comfort
 * this whole panel exists to remove, so it takes the row down to a warning and
 * says why underneath.
 */
function LockCheck({
  lock,
  loading,
  unbacked,
}: {
  lock: Lock | undefined;
  loading: boolean;
  unbacked: boolean;
}) {
  const { t } = useI18n();
  const verdict = lock && !loading ? verdictOf(lock) : undefined;
  const face = verdict ? LOCK_FACE[verdict] : undefined;
  const share = lock ? shareOf(lock) : undefined;
  const rounded = share === undefined ? undefined : Math.round(share);

  /* A burn parked outside the traded range is not the good news it scores as. */
  const tone = face ? (unbacked && face.tone === "long" ? "warn" : face.tone) : "text-faint";

  return (
    <div className="panel mt-2 flex items-center justify-between gap-3 p-3">
      <span className="flex min-w-0 items-center gap-2.5">
        {/*
         * A trace rather than a verdict while the pools are being read. The
         * exit check beside this one shows a faint tick in the same state,
         * which on a row about safety is the wrong shape to hold the place —
         * a tick that has not been earned is read as one that has.
         */}
        <Icon
          name={loading ? "pulse" : face && !unbacked ? face.icon : "alert"}
          size={17}
          className={tone}
        />
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold">{t("snipe.lock")}</span>
          <span className="block text-[11px] leading-snug text-faint">
            {loading
              ? t("snipe.lockAsking")
              : face
                ? t(face.hint, { share: rounded ?? 0 })
                : t("snipe.lockFailed")}
          </span>
        </span>
      </span>
      <Figure
        className={`num shrink-0 text-[17px] ${tone}`}
        value={
          !face || rounded === undefined ? "—" : `${formatAmount(rounded)}%`
        }
      />
    </div>
  );
}

/**
 * Getting out again.
 *
 * The way in costs one signature and the way out costs two, and no app can
 * change that: an ERC-20 cannot be moved by a contract that has not been
 * allowed to move it, so a sale is an allowance and then a swap. The terminal
 * says so plainly rather than hiding the first step behind the second, and the
 * allowance it asks for is written for exactly the position being sold, so
 * nothing is left standing afterwards.
 *
 * It sells back into the side the pair is quoted in — the pool the shot came
 * through, priced by the same quoter — because a position taken through one
 * pool is a position that pool is known to be able to give up.
 */
function Exit({ pair, coinUsd }: { pair: Pair; coinUsd: number | undefined }) {
  const { t } = useI18n();
  const { address } = useAccount();
  const key = basisKey(address, pair.token);
  const basis = useAppStore((state) => (key ? state.basis[key] : undefined));
  const record = useAppStore((state) => state.record);

  const { data: balance, refetch } = useReadContract({
    address: pair.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const held = balance ?? 0n;
  const [slice, setSlice] = useState<number | undefined>(100);
  const [typed, setTyped] = useState("");

  /*
   * A fraction to tap and a figure to type, the same deal the stake gets.
   *
   * Three percentages cover most exits and cover none of the rest: a reader
   * taking a fixed number of tokens off the table, or leaving an exact amount
   * behind, had no way to say so. Whichever was touched last wins.
   */
  const wanted = useMemo(() => {
    const clean = typed.replace(",", ".").trim();
    if (!clean) return undefined;
    try {
      const value = parseUnits(clean, pair.decimals);
      return value > 0n ? value : undefined;
    } catch {
      return undefined;
    }
  }, [typed, pair.decimals]);

  /*
   * A hundred percent sends the balance itself rather than a hundredth of it
   * multiplied back up: the two differ by the rounding, and the difference is
   * dust left behind in a position the reader asked to be rid of. A typed
   * figure past the balance is clamped to it for the same reason — the chain
   * would refuse it, and refusing it here says so without a failed signature.
   */
  const asked = wanted ?? (slice === 100 ? held : (held * BigInt(slice ?? 0)) / 100n);
  const position = useSettled(asked > held ? held : asked);
  const tooMuch = wanted !== undefined && wanted > held;

  /*
   * Two questions, because they are two different trades. The slice is what is
   * being sold and has to be quoted at its own size; the whole position is what
   * the profit and loss is measured on, and scaling one into the other would be
   * wrong in the direction that flatters — a pool charges more for the larger
   * trade, so half a position doubled reads as worth more than the position is.
   *
   * At a hundred percent both ask the chain the same thing, which is one query
   * key, which is one request.
   */
  const sale = useRoutes(position > 0n ? pair.token : undefined, position);
  const entire = useRoutes(held > 0n ? pair.token : undefined, held);

  /*
   * The pair's own quote first; anything else only if that pool will not take
   * it. Falling back to the whole position's exits matters when the reader has
   * emptied the field — there is nothing being sold, so the sale has no routes,
   * and the position's worth above would go blank for a figure that has not
   * changed.
   */
  const offered = sale.tradable.length > 0 ? sale.tradable : entire.tradable;
  const chosen =
    offered.find(
      (option) => option.address.toLowerCase() === pair.quoteToken.toLowerCase(),
    ) ?? offered[0];
  const route = chosen ? sale.bestFor(chosen) : undefined;
  /*
   * The terminal's ceiling on both sides, and it has to be the same one. A
   * screen that lets a reader buy into a pool at fifteen percent and then
   * refuses to sell them out of it at five has not protected them from
   * anything — it has built the trap the exit check exists to find.
   */
  const slippage = route ? snipeSlippageFor(route.impactBps) : SLIPPAGE_FLOOR;
  const costly = route !== undefined && route.impactBps >= COSTLY;
  const capped = route !== undefined && slippageCapped(route.impactBps);

  /*
   * What this sale is worth, kept in a ref so the settle below can read it
   * without being rebuilt every time it moves — see the note on that callback.
   */
  const proceeds = route ? worth(route.amountOut, chosen, coinUsd) : undefined;
  const latest = useRef<number>(0);
  useEffect(() => {
    if (proceeds !== undefined) latest.current = proceeds;
  }, [proceeds]);

  /*
   * Stable, and it has to be: the hook fires this from an effect that keeps the
   * callback in its dependencies, so a fresh closure every render would record
   * the sale, refetch, re-render and record it again for as long as the receipt
   * stood. Recording what left is what lets the row above say whether the whole
   * position made money, so it has to happen exactly once.
   */
  const settle = useCallback(() => {
    record(address, pair.token, "received", latest.current);
    void refetch();
  }, [record, refetch, address, pair.token]);

  const { approved, approve, approving, send, sending, done, blocked, checking } = useSwapAction({
    token: pair.token,
    /*
     * The held quote above is for reading. Its floor was measured against the
     * last size, so a sale signed on it would go out guarded by the wrong
     * number — the rows keep it, the transaction waits for the chain.
     */
    route: sale.stale ? undefined : route,
    amountIn: position,
    slippageBps: slippage,
    onDone: settle,
  });

  if (held === 0n) return null;

  const units = (value: bigint, exit: (typeof EXITS)[number] | undefined) =>
    exit ? `${formatAmount(Number(formatUnits(value, exit.decimals)))} ${exit.symbol}` : "—";

  /*
   * Profit and loss over the whole position, not the slice being sold.
   *
   * What went in, what has already come back out, and what the rest would fetch
   * if it were sold now — so moving the slider changes what is being sold and
   * not what the position is worth.
   *
   * It is only offered when this app has seen the money go in. A wallet that
   * bought the token somewhere else holds units this screen has no cost for,
   * and a figure that quietly treats those as free would read as profit. The
   * row says nothing rather than saying something wrong.
   */
  const standing = chosen ? entire.bestFor(chosen) : undefined;
  const value = standing ? worth(afterFee(standing.amountOut), chosen, coinUsd) : undefined;
  const spent = basis && basis.spent > 0 ? basis.spent : undefined;
  const back = basis?.received ?? 0;
  const pnl = spent !== undefined && value !== undefined ? back + value - spent : undefined;

  return (
    <Panel className="mt-3" label={t("snipe.position")}>
      <Row
        k={t("snipe.held")}
        v={
          <Figure
            className="num"
            value={`${formatAmount(Number(formatUnits(held, pair.decimals)))} ${pair.symbol}`}
          />
        }
      />
      <Row
        k={t("snipe.worth")}
        v={
          <Figure
            className="num"
            pending={entire.stale}
            value={usd(value)}
          />
        }
      />
      {pnl !== undefined && spent !== undefined && (
        <Row
          k={t("snipe.pnl")}
          v={
            /* Two figures, because the share is set faint beside the money. */
            <span className="num">
              <Figure pending={entire.stale} value={signedUsd(pnl)} />
              <Figure
                className="text-faint"
                pending={entire.stale}
                value={` (${pnl >= 0 ? "+" : "-"}${formatAmount(
                  Number(((Math.abs(pnl) / spent) * 100).toFixed(1)),
                )}%)`}
              />
            </span>
          }
          tone={pnl >= 0 ? "long" : "short"}
        />
      )}

      <p className="lbl mt-3 mb-1.5">{t("snipe.sell")}</p>
      <Segmented
        options={SLICES.map((part) => ({ value: String(part), label: `${part}%` }))}
        value={wanted === undefined && slice !== undefined ? String(slice) : ""}
        onChange={(value) => {
          setTyped("");
          setSlice(Number(value));
        }}
      />

      <div className="relative mt-1.5">
        <input
          className="field num w-full pr-16"
          inputMode="decimal"
          placeholder={t("snipe.units")}
          aria-label={t("snipe.units")}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            setSlice(undefined);
          }}
        />
        <span className="lbl pointer-events-none absolute top-1/2 right-2.5 max-w-[56px] -translate-y-1/2 truncate">
          {pair.symbol}
        </span>
      </div>
      {tooMuch && <p className="warn mt-1.5 text-[11px]">{t("swap.tooMuch")}</p>}

      <div className="mt-3">
        <Row
          k={t("snipe.youGet")}
          v={
            <Figure
              className="num"
              pending={sale.stale}
              value={route ? units(afterFee(route.amountOut), chosen) : "—"}
            />
          }
        />
        <Row
          k={t("snipe.atLeast")}
          v={
            <Figure
              className="num"
              pending={sale.stale}
              value={route ? units(afterFee(floorFor(route.amountOut, slippage)), chosen) : "—"}
            />
          }
        />
        <Row k={t("snipe.fee")} v={<span className="num">{`${percent(FEE_BIPS)}%`}</span>} />
      </div>

      {route && costly && (
        <Notice
          title={t("snipe.costly", { percent: percent(route.impactBps) })}
          hint={
            capped
              ? t("snipe.cappedHint", { cap: percent(SNIPE_CEILING) })
              : t("snipe.costlyHint")
          }
        />
      )}
      {blocked && <Notice title={t("swap.blocked")} hint={t("swap.blockedHint")} />}

      <button
        type="button"
        className="btn btn-short mt-2 w-full"
        disabled={
          !route || sale.stale || approving || sending || checking || (approved && !!blocked)
        }
        onClick={() => (approved ? send() : approve())}
      >
        {done
          ? t("swap.done")
          : sending
            ? t("swap.sending")
            : approving
              ? t("swap.approving")
              : checking
                ? t("swap.checking")
                : approved
                  ? t("snipe.dump", { symbol: pair.symbol })
                  : t("swap.approve", { symbol: pair.symbol })}
      </button>
    </Panel>
  );
}

/**
 * The shot.
 *
 * One target, one size, one button. Everything a reader would otherwise have to
 * set is worked out from the pool instead — the tolerance from what the trade
 * already costs itself, the road in from which side the pair is quoted — and
 * the one thing no screen usually tells them is asked outright before they can
 * fire: whether what they are about to buy can be sold again.
 */
export function Terminal() {
  const mounted = useMounted();
  const { t } = useI18n();
  const prompt = useConnectPrompt();
  const { address } = useAccount();
  const { pairs, loading, error, refetch } = useScreener();

  const [picking, setPicking] = useState(false);
  const [aimed, setAimed] = useState<string>();
  const [auto, setAuto] = useState(false);
  const [preset, setPreset] = useState<number | undefined>(STAKES[0]);
  const [typed, setTyped] = useState("");

  const listed = useMemo(() => targets(pairs), [pairs]);

  /*
   * The coin's price, with the screen's own reading behind it. The hook asks
   * the reference pool directly; every pair quoted in the coin has already been
   * priced against that same pool by the screener, so if the dedicated read has
   * not landed yet there is an answer sitting in the list — and the two are the
   * same number from the same place, not a second opinion.
   */
  const measured = useCoinUsd();
  const coinUsd =
    measured ?? listed.find((pair) => pair.quote === "WETH" && pair.usdRate > 0)?.usdRate;
  /*
   * A ladder for the common sizes and a field for every other one.
   *
   * The presets were the whole control, which quietly decided that nobody
   * trades ten dollars in two-dollar bites — and a reader holding ten dollars
   * had four buttons of which three were unaffordable and one was their entire
   * balance, gas included. Whichever was touched last wins: typing clears the
   * preset, tapping a preset clears the field.
   */
  const custom = useMemo(() => {
    const clean = typed.replace(",", ".").trim();
    if (!clean) return undefined;
    const value = Number(clean);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }, [typed]);

  const stakeUsd = useSettled(custom ?? preset ?? 0);
  const stake = useMemo(() => stakeIn(stakeUsd, coinUsd), [stakeUsd, coinUsd]);

  /* What the wallet could actually put in, for the ladder and for `Max`. */
  const held = useBalance({ address, chainId: CHAIN_ID });
  const spendable =
    held.data && coinUsd !== undefined
      ? Math.max(Number(formatEther(held.data.value)) * coinUsd - RESERVE, 0)
      : undefined;

  /*
   * Asking for more than the wallet can send, judged here rather than deeper
   * down. The check inside `useFire` compares the stake against the whole
   * balance, which only catches a stake larger than everything held — a stake
   * that fits but leaves nothing for gas slips past it and surfaces as the
   * chain refusing the trade, which is true and says nothing useful. This
   * screen already knows what is spendable once gas is kept back, so it is the
   * one place that can name the real reason.
   */
  const overBalance = spendable !== undefined && stakeUsd > spendable;

  /*
   * A target picked here, or one handed over from the memecoin screens.
   *
   * The live row wins wherever there is one, so a pair this screen is already
   * watching keeps describing itself with the identity it already has. A
   * handed pair that this list does not carry is kept anyway rather than
   * dropped: the terminal can quote anything, and the reason it is missing is
   * usually that nobody traded it in the last five minutes.
   *
   * Only the identity travels this way — pool, token, decimals, which side is
   * which. What the panel shows about it is asked for on its own, below, so a
   * pool that arrived with no reading at all reads exactly like one that
   * arrived with a stale one: neither is trusted for figures a fresh read can
   * answer.
   *
   * A target picked from this screen's own list and then falling out of it is
   * still dropped, because there it means the pool went quiet while the reader
   * was looking at numbers that would otherwise sit there frozen.
   */
  const handed = useAppStore((state) => state.aimed);
  const aim = useAppStore((state) => state.aim);
  useEffect(() => {
    if (handed) {
      setAimed(handed.pool);
      setAuto(false);
    }
  }, [handed]);

  const target =
    listed.find((pair) => pair.pool === aimed) ??
    (handed?.pool === aimed ? handed : undefined);

  /*
   * The four figures on the panel, read fresh for this one pool rather than
   * carried over from whichever source handed the target across — see
   * `useTargetDetail` for why that used to disagree with itself.
   */
  const { stats, loading: statsLoading } = useTargetDetail(target);

  useEffect(() => {
    if (!aimed || handed?.pool === aimed) return;
    if (!listed.some((pair) => pair.pool === aimed)) setAimed(undefined);
  }, [aimed, listed, handed]);

  /*
   * Auto keeps the aim moving to the top of `targets` by itself, so a reader
   * does not have to be watching the list the instant something worth shooting
   * appears. It only ever changes which pool is aimed at.
   *
   * It never fires. `fire` is still the tap on the button below, still gated
   * on the same simulation and the same exit check as a shot picked by hand —
   * this hook has no path to `pull`. What was once armed to trade unattended
   * is not being rebuilt; this only saves the reader the tap that points the
   * gun, never the one that pulls it.
   */
  useEffect(() => {
    if (!auto || listed.length === 0) return;
    const top = listed[0];
    if (top.pool === aimed) return;
    aim(undefined);
    setAimed(top.pool);
  }, [auto, listed, aimed, aim]);

  const { shot, unquotable, loading: quoting } = useShot(target, stake);
  /*
   * The figures on screen are the last size's, and the chain has not answered
   * for this one yet. They are dimmed rather than cleared — see `useShot` — and
   * the trigger is already refusing them, so this is only how they are shown.
   */
  const stale = shot?.stale ?? false;

  /*
   * Who holds the pool this shot goes through.
   *
   * The same query the memecoin list fills in the background, on the same key,
   * so a reader who came here by tapping a row has already paid for this answer
   * and it arrives on the first frame. One that came straight to the terminal
   * pays for it once, while they are still choosing a size.
   */
  const { lock, loading: lockLoading } = useLiquidityLock(target?.pool);
  const lockVerdict = lock && !lockLoading ? verdictOf(lock) : undefined;
  const lockShare = lock ? shareOf(lock) : undefined;

  /*
   * Withdrawable by somebody, and enough of it to matter. `unread` is not in
   * here on purpose — see `LOCK_FACE` for why an absence of knowledge does not
   * get to fire a warning.
   */
  const pullable =
    lockVerdict === "open" ||
    (lockVerdict === "mixed" && (lockShare ?? 0) < MOSTLY_BURNED);

  /* Burned, and burned somewhere the price this pool trades at cannot reach. */
  const unbacked = Boolean(lock && lock.burned > 0n && lock.backsPrice === false);

  /*
   * What this shot cost, kept where a stable callback can read it. `useFire`
   * runs its completion from an effect that keeps the callback in its
   * dependencies, so a closure rebuilt on every render would record the same
   * fill over and over for as long as the receipt stood.
   */
  const record = useAppStore((state) => state.record);
  /*
   * The wallet rides in the ref beside the fill, rather than being read when
   * the receipt lands. A reader who switches accounts while a transaction is in
   * flight would otherwise have the fill filed against whoever is connected
   * when it confirms, which is the same mistake the unscoped key used to make,
   * only narrower.
   */
  const filled = useRef<{ owner?: `0x${string}`; token?: `0x${string}`; usd: number }>({
    usd: 0,
  });
  useEffect(() => {
    filled.current = { owner: address, token: target?.token, usd: stakeUsd };
  }, [address, target?.token, stakeUsd]);

  const banked = useCallback(() => {
    const { owner, token, usd } = filled.current;
    if (token) record(owner, token, "spent", usd);
  }, [record]);

  const { fire, firing, done, hash, short, checking, blocked, failure, ready, reset } = useFire({
    pair: target,
    stake,
    shot,
    onDone: banked,
  });

  const coin = chainMeta(CHAIN_ID)?.nativeName ?? "ETH";
  const hops = target && target.quoteToken.toLowerCase() === VENUE.wrapped.toLowerCase() ? 1 : 2;

  /* A new target or a new size is a new shot; the last one's receipt is not it. */
  useEffect(() => {
    reset();
  }, [aimed, stake, reset]);

  /*
   * See the note on the button. Shut on the tap, and opened again by a timer.
   *
   * A timer rather than the write's own state, which is what this was first
   * written against and which turned out to be a button that could die. A tap
   * whose call never reaches the wallet — the simulation momentarily absent,
   * the write refusing before it starts — changes no state at all, so there is
   * no transition to open the latch on, and every later tap is swallowed in
   * silence. The window only has to outlast the render that sets `firing`;
   * anything past that is the button's `disabled` doing the work.
   */
  const latch = useRef<number>(undefined);
  useEffect(
    () => () => {
      if (latch.current !== undefined) window.clearTimeout(latch.current);
    },
    [],
  );

  const pull = useCallback(() => {
    if (latch.current !== undefined) return;
    latch.current = window.setTimeout(() => {
      latch.current = undefined;
    }, LATCH);
    haptic("commit");
    fire();
  }, [fire]);

  const amount = (value: bigint) =>
    target ? `${formatAmount(Number(formatUnits(value, target.decimals)))} ${target.symbol}` : "—";

  if (!mounted) {
    return (
      <div className={SHELL}>
        <div className={SPLIT}>
          <div className="hidden lg:block">
            <Skeleton className="h-[420px] w-full rounded-[var(--radius-sm)]" />
          </div>
          <Skeleton className="h-[86px] w-full rounded-[var(--radius-sm)]" />
        </div>
      </div>
    );
  }

  return (
    <div className={SHELL}>
      <h1 className="sr-only">{t("page.home.title")}</h1>

      <div className={SPLIT}>
        {/*
         * The targets, pinned.
         *
         * A sniper screen with nothing aimed at was a single panel in the
         * middle of an empty desk, and with something aimed at it was the same
         * column of a phone stretched down the centre of a monitor — the list
         * of things worth shooting at, which is the only content the screen
         * has when nothing is chosen, sat behind a button the whole time.
         *
         * So on a wide screen it is a column of its own: what there is, beside
         * what one of them would cost. It stays where it is while the terminal
         * scrolls, because picking the next target is a thing a reader does
         * from wherever they got to in the last one. Below `lg` nothing
         * changes — there is one column, and the list is still a sheet.
         */}
        <Panel
          className="hidden lg:block lg:sticky lg:top-[calc(var(--shell-top)+var(--shell-strip)+16px)]"
          label={t("snipe.targets")}
          meta={listed.length > 0 && <span className="lbl">{listed.length}</span>}
          bodyClassName="panel-body scroll-thin max-h-[calc(100dvh-var(--shell-top)-var(--shell-strip)-96px)] overflow-y-auto"
        >
          <AddressAim
            onAim={(pair) => {
              aim(pair);
              setAimed(pair.pool);
            }}
          />
          <TargetList
            pairs={listed}
            loading={loading}
            chosen={aimed}
            onPick={(pool) => {
              aim(undefined);
              setAimed(pool);
              setAuto(false);
            }}
          />
        </Panel>

      <div className="min-w-0">
      <Panel
        label={t("snipe.target")}
        action={
          <div className="flex items-center gap-1.5">
            {/*
             * A short toggle, not a control that spends the reader's attention:
             * one word and a state, next to the button that does the same job
             * by hand. See the effect above for what it does and does not do.
             */}
            <button
              type="button"
              className={`btn btn-sm ${auto ? "btn-accent" : "btn-short"}`}
              aria-pressed={auto}
              title={t("snipe.autoHint")}
              onClick={() => setAuto((value) => !value)}
            >
              <Icon name="power" size={13} />
              {t("snipe.auto")}
            </button>
            {listed.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-short lg:hidden"
                onClick={() => setPicking(true)}
              >
                <Icon name="crosshair" size={13} />
                {target ? t("snipe.change") : t("snipe.pick")}
              </button>
            )}
          </div>
        }
      >
        {error ? (
          <Empty
            title={t("launches.failed")}
            hint={t("launches.failedHint")}
            action={
              <button type="button" className="btn btn-sm btn-short" onClick={() => void refetch()}>
                <Icon name="refresh" size={13} />
                {t("balance.retry")}
              </button>
            }
          />
        ) : target ? (
          /*
           * The target, read across the panel rather than stacked down the
           * middle of it.
           *
           * This borrowed `.identity` from the account sheet, which is a
           * centred column because a sheet is a phone's width and there is
           * nothing beside it. In a panel it left a block of air either side of
           * three short lines, and it said only two things about a pair the
           * list beside it says four about — so picking a target from the list
           * threw away half of what the reader had just been shown.
           *
           * So: who it is on the left, what it is worth on the right, and the
           * rest of the reading underneath. The figures keep moving while the
           * reader looks at them, which is what `Figure` is for.
           */
          <div className="p-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-[19px] leading-tight font-bold">
                  {target.symbol}
                  <span className="text-faint">/{target.quote}</span>
                </p>
                <p className={`num mt-1.5 text-[12px] ${(stats?.change ?? 0) >= 0 ? "long" : "short"}`}>
                  <Figure
                    pending={statsLoading}
                    value={`${(stats?.change ?? 0) >= 0 ? "+" : ""}${(stats?.change ?? 0).toFixed(1)}%`}
                  />
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="num text-[26px] leading-none">
                  <Figure pending={statsLoading} value={usd(stats?.marketCap)} />
                </p>
                <p className="lbl mt-2">{t("launches.mcap")}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 border-t border-line pt-3">
              <div className="min-w-0 pr-3">
                <p className="lbl">{t("launches.liquidity")}</p>
                <p className="num mt-1.5 truncate text-[13px]">
                  <Figure pending={statsLoading} value={usd(stats?.liquidity ?? 0)} />
                </p>
              </div>
              <div className="min-w-0 border-l border-line px-3">
                <p className="lbl">{t("launches.volume")}</p>
                <p className="num mt-1.5 truncate text-[13px]">
                  <Figure pending={statsLoading} value={usd(stats?.volume ?? 0)} />
                </p>
              </div>
              <div className="min-w-0 border-l border-line pl-3">
                <p className="lbl">{t("launches.trades")}</p>
                <p className="num mt-1.5 truncate text-[13px]">
                  <Figure pending={statsLoading} value={formatCompact(stats?.swaps ?? 0)} />
                </p>
              </div>
            </div>

            <a
              href={`${DEXSCREENER}/${target.pool}`}
              target="_blank"
              rel="noreferrer"
              className="icon-btn mt-3"
              title={t("snipe.dexscreener")}
              aria-label={t("snipe.dexscreener")}
            >
              <Icon name="external" size={16} />
            </a>
          </div>
        ) : loading ? (
          <div className="flex flex-col gap-1.5">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
            ))}
          </div>
        ) : listed.length === 0 ? (
          <Empty title={t("snipe.empty")} hint={t("snipe.emptyHint")} />
        ) : (
          <Empty
            title={t("snipe.noTarget")}
            hint={t("snipe.noTargetHint")}
            action={
              <button
                type="button"
                className="btn btn-accent btn-sm lg:hidden"
                onClick={() => setPicking(true)}
              >
                <Icon name="crosshair" size={13} />
                {t("snipe.pick")}
              </button>
            }
          />
        )}
      </Panel>

      {target && (
        <>
          <div className="mt-3 mb-1.5 flex items-baseline justify-between gap-2">
            <p className="lbl">{t("snipe.stake")}</p>
            {/*
             * The coin figure is shown and not chosen. The dollars are the
             * decision; this is the receipt for it, and a reader who wants to
             * know what leaves their wallet should not have to work it out.
             */}
            {/* What this wallet could put in, once gas is kept back. */}
            <p className="num text-[11px] text-faint">
              {spendable !== undefined
                ? t("snipe.spendable", { amount: `$${formatAmount(floorCents(spendable))}` })
                : "—"}
            </p>
          </div>
          {/*
           * Every rung is live, including the ones this wallet cannot pay for.
           *
           * They were disabled, which was wrong twice over. There is no styling
           * in this app for a dead segment, so a rung a reader could not afford
           * looked exactly like one they could and simply did nothing when
           * tapped — a control that refuses in silence, which reads as broken
           * rather than as unaffordable. And it withheld the one thing the
           * reader was asking for by tapping it: what fifty dollars of this
           * token would be.
           *
           * So the size is always selectable, the quote is always shown, and
           * the balance is answered where an answer can carry a reason — the
           * notice below and the trigger it disables.
           */}
          <Segmented
            options={STAKES.map((size) => ({ value: String(size), label: `$${size}` }))}
            value={custom === undefined && preset !== undefined ? String(preset) : ""}
            onChange={(value) => {
              setTyped("");
              setPreset(Number(value));
            }}
          />

          <div className="mt-1.5 flex items-center gap-2">
            {/*
             * The unit is marked inside the box rather than left to the row
             * around it. Every preset says dollars and the receipt below says
             * the coin, but the one place a reader could still mean something
             * else is the field they type into.
             */}
            <div className="relative min-w-0 flex-1">
              <span className="num pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-faint">
                $
              </span>
              <input
                className="field num w-full pl-5"
                inputMode="decimal"
                placeholder={t("snipe.custom")}
                aria-label={t("snipe.custom")}
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setPreset(undefined);
                }}
              />
            </div>
            {/*
             * Everything, less what the sending costs. Gas comes out of the
             * same balance as the stake, so a max that meant the whole balance
             * would be a button that always fails.
             */}
            <button
              type="button"
              className="btn btn-sm btn-short"
              disabled={spendable === undefined || spendable <= 0}
              onClick={() => {
                setPreset(undefined);
                setTyped(spendable ? String(floorCents(spendable)) : "");
              }}
            >
              {t("swap.max")}
            </button>
          </div>

          {/*
           * The coin figure is shown and not chosen. The dollars are the
           * decision; this is the receipt for it, and a reader who wants to
           * know what actually leaves their wallet should not have to work it
           * out from a rate they were never shown.
           */}
          {stake > 0n && (
            <p className="num mt-1.5 text-right text-[11px] text-faint">
              <Figure value={`≈ ${formatAmount(Number(formatEther(stake)))} ${coin}`} />
            </p>
          )}

          {/*
           * The exit check, above everything and on its own.
           *
           * It was the fifth row of a list of six, read after the price, the
           * impact and the tolerance — which is the wrong order, because it is
           * the only line here that can say do not. The rest of the panel
           * describes what this trade costs; this says whether there is a way
           * back out of it at all, and a reader choosing a size should have
           * settled that before they choose one.
           *
           * It is the same question no other terminal on any chain asks in this
           * form. A rug check reads what a contract declares about itself. This
           * runs the sale through the pool's own code and reports what came
           * back, so a token that can be bought and not sold has nowhere to
           * hide behind a clean-looking contract.
           */}
          <div
            className="panel mt-2 flex items-center justify-between gap-3 p-3"
            data-exit={shot?.trapped ? "blocked" : shot?.roundTrip !== undefined ? "open" : undefined}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <Icon
                name={shot?.trapped ? "alert" : "check"}
                size={17}
                className={
                  shot?.trapped ? "short" : shot?.roundTrip !== undefined ? "long" : "text-faint"
                }
              />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold">{t("snipe.exit")}</span>
                <span className="block text-[11px] leading-snug text-faint">
                  {shot?.trapped
                    ? t("snipe.exitNoneHint")
                    : shot?.roundTrip !== undefined
                      ? t("snipe.exitBackHint")
                      : t("snipe.exitAsking")}
                </span>
              </span>
            </span>
            <Figure
              className={`num shrink-0 text-[17px] ${
                shot?.trapped
                  ? "short"
                  : shot?.roundTrip === undefined
                    ? "text-faint"
                    : shot.roundTrip < 0.9
                      ? "warn"
                      : "long"
              }`}
              pending={stale}
              value={
                shot?.trapped
                  ? t("snipe.exitNone")
                  : shot?.roundTrip !== undefined
                    ? `${formatAmount(Number((shot.roundTrip * 100).toFixed(1)))}%`
                    : "—"
              }
            />
          </div>

          {/*
           * The second half of the same question, directly under the first.
           *
           * The exit check above asks whether this can be sold; this asks
           * whether the pool it would be sold into can be taken away. They are
           * the only two lines on the screen that can say do not, they fail in
           * ways that look identical once the money is gone, and neither one
           * answers for the other — so they are read as a pair, before the
           * price rows that describe what the trade merely costs.
           */}
          <LockCheck lock={lock} loading={lockLoading} unbacked={unbacked} />

          <div className="panel mt-2 p-3">
            <Row
              k={t("snipe.youGet")}
              v={
                <Figure
                  className="num"
                  pending={stale}
                  value={shot ? amount(shot.amountOut) : "—"}
                />
              }
            />
            <Row
              k={t("snipe.atLeast")}
              v={<Figure className="num" pending={stale} value={shot ? amount(shot.floor) : "—"} />}
            />
            <Row
              k={t("snipe.impact")}
              v={
                <Figure
                  className="num"
                  pending={stale}
                  value={shot ? `${percent(shot.impactBps)}%` : "—"}
                />
              }
              tone={shot && shot.impactBps >= COSTLY ? "warn" : undefined}
            />
            <Row
              k={t("snipe.slippage")}
              v={
                <Figure
                  className="num"
                  pending={stale}
                  value={shot ? `${percent(shot.slippageBps)}%` : "—"}
                />
              }
              tone={shot?.capped ? "warn" : undefined}
            />
            <Row k={t("snipe.fee")} v={<span className="num">{`${percent(FEE_BIPS)}%`}</span>} />
            <Row
              k={t("snipe.route")}
              v={
                <span className="num">
                  {hops === 1
                    ? t("snipe.oneHop", { fee: percent(target.fee / 100) })
                    : t("snipe.twoHops", { fee: percent(target.fee / 100) })}
                </span>
              }
            />
          </div>

          {unquotable && !quoting && (
            <Notice title={t("snipe.unquotable")} hint={t("snipe.unquotableHint")} />
          )}
          {shot?.trapped && <Notice title={t("snipe.trapped")} hint={t("snipe.trappedHint")} />}
          {/*
           * Said out loud rather than left to the row, because the row reads as
           * one measurement among several and this is the one that empties a
           * wallet. It does not stop the shot: a withdrawable pool is most of
           * this chain, and a terminal that refused them would be a terminal
           * that cannot trade. It is a thing the reader has to have been told.
           */}
          {pullable && <Notice title={t("snipe.pullable")} hint={t("snipe.pullableHint")} />}
          {unbacked && <Notice title={t("snipe.outOfRange")} hint={t("lock.outOfRange")} />}
          {/*
           * A price, not a verdict. The pool charges what it charges for a
           * trade this size and the figure above already has it in — so this
           * says what that costs and leaves the button alone, which is the
           * whole of what a sniper is for. The one thing that does stop a shot
           * is the exit check above it.
           */}
          {shot && !shot.trapped && shot.impactBps >= COSTLY && (
            <Notice
              title={t("snipe.costly", { percent: percent(shot.impactBps) })}
              hint={
                shot.capped
                  ? t("snipe.cappedHint", { cap: percent(SNIPE_CEILING) })
                  : t("snipe.costlyHint")
              }
            />
          )}
          {(short || overBalance) && (
            <Notice title={t("snipe.short", { coin })} hint={t("snipe.shortHint")} />
          )}
          {blocked && !shot?.trapped && (
            <Notice title={t("snipe.blocked")} hint={t("snipe.blockedHint")} />
          )}
          {failure && <p className="warn mt-2 text-[11px]">{t("snipe.failed")}</p>}

          {address ? (
            /*
             * One tap, and the browser already makes that safe.
             *
             * This was a slide, on the reasoning that a tap on a phone is the
             * same gesture as scrolling past. That reasoning was wrong about
             * how the platform works: a `click` fires on the up-event, not the
             * down-event, and the browser withholds it if the pointer moves off
             * the control or the gesture turns into a scroll. That is WCAG
             * 2.5.2 — pointer cancellation — and a plain button satisfies it
             * without being asked to. The slide was re-implementing a guarantee
             * the platform already gives, and charging the reader a gesture for
             * it, on the one screen whose whole point is not to be slow. Every
             * terminal in this category settled on one click against a preset
             * long ago.
             *
             * What a plain button does not guard against is a second tap
             * landing before the first has changed anything on screen, which
             * would put two transactions in flight. `disabled` cannot close
             * that window on its own because the state behind it settles a
             * render later, so the latch below does — it shuts on the tap and
             * opens again when the write is no longer in flight, including
             * when the reader rejects it in their wallet.
             */
            <button
              type="button"
              className="btn btn-accent aim mt-2 w-full"
              disabled={!ready || overBalance || firing || quoting || checking || shot?.trapped}
              onClick={pull}
            >
              <Icon name="crosshair" size={14} />
              {done
                ? t("snipe.done")
                : firing
                  ? t("snipe.firing")
                  : quoting || checking
                    ? t("snipe.checking")
                    : t("snipe.fire", { symbol: target.symbol })}
            </button>
          ) : (
            prompt && (
              <button type="button" className="btn btn-accent mt-2 w-full" onClick={prompt}>
                <Icon name="wallet" size={14} />
                {t("wallet.connect")}
              </button>
            )
          )}

          {done && hash && (
            <a
              href={explorerTx(CHAIN_ID, hash)}
              target="_blank"
              rel="noreferrer"
              className="tile mt-2 justify-center"
            >
              <Icon name="external" size={14} className="text-dim" />
              {t("snipe.receipt")}
            </a>
          )}
        </>
      )}

      {target && address && <Exit pair={target} coinUsd={coinUsd} />}
      </div>
      </div>

      <TargetSheet
        open={picking}
        pairs={listed}
        loading={loading}
        chosen={aimed}
        onPick={(pool) => {
          aim(undefined);
          setAimed(pool);
          setAuto(false);
        }}
        onAim={(pair) => {
          aim(pair);
          setAimed(pair.pool);
        }}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
