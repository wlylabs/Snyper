"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, chainMeta, explorerTx } from "@/lib/chains";
import { haptic } from "@/lib/haptics";
import { formatAmount, formatCompact } from "@/lib/format";
import { CEILING, FLOOR } from "@/lib/screener";
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
import { useCoinUsd } from "@/hooks/useCoinUsd";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { useScreener, type Pair } from "@/hooks/useScreener";
import { STAKES, stakeIn, useFire, useShot } from "@/hooks/useSnipe";
import { useRoutes, useSwapAction } from "@/hooks/useSwap";
import { useAppStore } from "@/store/useAppStore";

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

function usd(value: number | undefined): string {
  return value === undefined ? "—" : `$${formatCompact(value)}`;
}

/**
 * What the terminal will point at.
 *
 * The memecoin screen is a list to read and this is a list to shoot at, so the
 * bar is different: everything above the ceiling is somebody else's entry, and
 * everything that has not been shown to have a market — a floor's worth resting
 * in the pool and a floor's worth traded through it — is not a target, it is a
 * pool with a name. Busiest first, because inside those limits the only
 * question left is what is moving now.
 */
function targets(pairs: Pair[]): Pair[] {
  return pairs
    .filter(
      (pair) =>
        (pair.marketCap === undefined || pair.marketCap <= CEILING) &&
        pair.liquidity >= FLOOR &&
        pair.volume >= FLOOR,
    )
    .sort((a, b) => b.volume - a.volume);
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

/** A signed dollar figure, for a profit and loss that has to show its sign. */
function signedUsd(value: number): string {
  return `${value >= 0 ? "+" : "-"}$${formatCompact(Math.abs(value))}`;
}

function TargetSheet({
  open,
  pairs,
  loading,
  chosen,
  onPick,
  onClose,
}: {
  open: boolean;
  pairs: Pair[];
  loading: boolean;
  chosen: string | undefined;
  onPick: (pool: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();

  return (
    <Sheet open={open} title={t("snipe.targets")} onClose={onClose}>
      <div className="p-3">
        {loading && pairs.length === 0 ? (
          <div className="flex flex-col gap-1.5">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} className="h-[46px] w-full rounded-[var(--radius-xs)]" />
            ))}
          </div>
        ) : pairs.length === 0 ? (
          <Empty title={t("snipe.empty")} hint={t("snipe.emptyHint")} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {pairs.map((pair) => (
              <button
                key={pair.pool}
                type="button"
                className="tile"
                aria-current={pair.pool === chosen}
                onClick={() => {
                  onPick(pair.pool);
                  onClose();
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {pair.symbol}
                    <span className="font-normal text-faint">/{pair.quote}</span>
                  </span>
                  <span className="block truncate text-[11px] font-normal text-faint">
                    <span className="lbl">{t("memecoin.liqShort")}</span>{" "}
                    <span className="num">{usd(pair.liquidity)}</span>
                    {" · "}
                    <span className="lbl">{t("memecoin.volShort")}</span>{" "}
                    <span className="num">{usd(pair.volume)}</span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="num block text-[12px]">{usd(pair.marketCap)}</span>
                  <span
                    className={`num block text-[11px] font-normal ${pair.change >= 0 ? "long" : "short"}`}
                  >
                    {`${pair.change >= 0 ? "+" : ""}${pair.change.toFixed(1)}%`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
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
  const basis = useAppStore((state) => state.basis[pair.token.toLowerCase()]);
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
  const [slice, setSlice] = useState<number>(100);

  /*
   * A hundred percent sends the balance itself rather than a hundredth of it
   * multiplied back up: the two differ by the rounding, and the difference is
   * dust left behind in a position the reader asked to be rid of.
   */
  const position = slice === 100 ? held : (held * BigInt(slice)) / 100n;

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

  /* The pair's own quote first; anything else only if that pool will not take it. */
  const chosen =
    sale.tradable.find(
      (option) => option.address.toLowerCase() === pair.quoteToken.toLowerCase(),
    ) ?? sale.tradable[0];
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
    record(pair.token, "received", latest.current);
    void refetch();
  }, [record, refetch, pair.token]);

  const { approved, approve, approving, send, sending, done, blocked, checking } = useSwapAction({
    token: pair.token,
    route,
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
          <span className="num">
            {`${formatAmount(Number(formatUnits(held, pair.decimals)))} ${pair.symbol}`}
          </span>
        }
      />
      <Row
        k={t("snipe.worth")}
        v={<span className="num">{value === undefined ? "—" : `$${formatCompact(value)}`}</span>}
      />
      {pnl !== undefined && spent !== undefined && (
        <Row
          k={t("snipe.pnl")}
          v={
            <span className="num">
              {signedUsd(pnl)}
              <span className="text-faint">
                {` (${pnl >= 0 ? "+" : "-"}${formatAmount(
                  Number(((Math.abs(pnl) / spent) * 100).toFixed(1)),
                )}%)`}
              </span>
            </span>
          }
          tone={pnl >= 0 ? "long" : "short"}
        />
      )}

      <p className="lbl mt-3 mb-1.5">{t("snipe.sell")}</p>
      <Segmented
        options={SLICES.map((part) => ({ value: String(part), label: `${part}%` }))}
        value={String(slice)}
        onChange={(value) => setSlice(Number(value))}
      />

      <div className="mt-3">
        <Row
          k={t("snipe.youGet")}
          v={<span className="num">{route ? units(afterFee(route.amountOut), chosen) : "—"}</span>}
        />
        <Row
          k={t("snipe.atLeast")}
          v={
            <span className="num">
              {route ? units(afterFee(floorFor(route.amountOut, slippage)), chosen) : "—"}
            </span>
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
        disabled={!route || approving || sending || checking || (approved && !!blocked)}
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
      <p className="mt-2 text-center text-[11px] text-faint">{t("snipe.twoSignatures")}</p>
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
  const [stakeUsd, setStakeUsd] = useState<number>(STAKES[0]);

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
  const stake = useMemo(() => stakeIn(stakeUsd, coinUsd), [stakeUsd, coinUsd]);

  /*
   * The target is held by address and looked up live, so a row still describes
   * the pool as it is now rather than as it was at the tap. A target that falls
   * out of the list — traded past the ceiling, or simply quiet for five minutes
   * — is dropped rather than left on screen with numbers that stopped moving.
   */
  const target = listed.find((pair) => pair.pool === aimed);
  useEffect(() => {
    if (aimed && !listed.some((pair) => pair.pool === aimed)) setAimed(undefined);
  }, [aimed, listed]);

  const { shot, unquotable, loading: quoting } = useShot(target, stake);

  /*
   * What this shot cost, kept where a stable callback can read it. `useFire`
   * runs its completion from an effect that keeps the callback in its
   * dependencies, so a closure rebuilt on every render would record the same
   * fill over and over for as long as the receipt stood.
   */
  const record = useAppStore((state) => state.record);
  const filled = useRef<{ token?: `0x${string}`; usd: number }>({ usd: 0 });
  useEffect(() => {
    filled.current = { token: target?.token, usd: stakeUsd };
  }, [target?.token, stakeUsd]);

  const banked = useCallback(() => {
    if (filled.current.token) record(filled.current.token, "spent", filled.current.usd);
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
      <div className="mx-auto w-full max-w-3xl">
        <Skeleton className="h-[86px] w-full rounded-[var(--radius-sm)]" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="sr-only">{t("page.home.title")}</h1>

      <Panel
        label={t("snipe.target")}
        action={
          listed.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-short"
              onClick={() => setPicking(true)}
            >
              <Icon name="crosshair" size={13} />
              {target ? t("snipe.change") : t("snipe.pick")}
            </button>
          )
        }
      >
        {error ? (
          <Empty
            title={t("memecoin.failed")}
            hint={t("memecoin.failedHint")}
            action={
              <button type="button" className="btn btn-sm btn-short" onClick={() => void refetch()}>
                <Icon name="refresh" size={13} />
                {t("balance.retry")}
              </button>
            }
          />
        ) : target ? (
          <div className="identity">
            <div>
              <p className="text-[19px] leading-tight font-bold">
                {target.symbol}
                <span className="text-faint">/{target.quote}</span>
              </p>
              <p className="lbl mt-1">{t("memecoin.mcap")}</p>
            </div>
            <div className="mt-1">
              <p className="num text-[26px] leading-none">{usd(target.marketCap)}</p>
              <p className={`lbl mt-1 ${target.change >= 0 ? "long" : "short"}`}>
                {`${target.change >= 0 ? "+" : ""}${target.change.toFixed(1)}%`}
              </p>
            </div>
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
                className="btn btn-accent btn-sm"
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
            <p className="num text-[11px] text-faint">
              {stake > 0n ? `≈ ${formatAmount(Number(formatEther(stake)))} ${coin}` : "—"}
            </p>
          </div>
          <Segmented
            options={STAKES.map((size) => ({ value: String(size), label: `$${size}` }))}
            value={String(stakeUsd)}
            onChange={(value) => setStakeUsd(Number(value))}
          />

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
            <span
              className={`num shrink-0 text-[17px] ${
                shot?.trapped
                  ? "short"
                  : shot?.roundTrip === undefined
                    ? "text-faint"
                    : shot.roundTrip < 0.9
                      ? "warn"
                      : "long"
              }`}
            >
              {shot?.trapped
                ? t("snipe.exitNone")
                : shot?.roundTrip !== undefined
                  ? `${formatAmount(Number((shot.roundTrip * 100).toFixed(1)))}%`
                  : "—"}
            </span>
          </div>

          <div className="panel mt-2 p-3">
            <Row
              k={t("snipe.youGet")}
              v={<span className="num">{shot ? amount(shot.amountOut) : "—"}</span>}
            />
            <Row
              k={t("snipe.atLeast")}
              v={<span className="num">{shot ? amount(shot.floor) : "—"}</span>}
            />
            <Row
              k={t("snipe.impact")}
              v={<span className="num">{shot ? `${percent(shot.impactBps)}%` : "—"}</span>}
              tone={shot && shot.impactBps >= COSTLY ? "warn" : undefined}
            />
            <Row
              k={t("snipe.slippage")}
              v={<span className="num">{shot ? `${percent(shot.slippageBps)}%` : "—"}</span>}
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
          {short && <Notice title={t("snipe.short", { coin })} hint={t("snipe.shortHint")} />}
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
              className="btn btn-accent mt-2 w-full"
              disabled={!ready || firing || quoting || checking || shot?.trapped}
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

          {/*
           * Said once, under the button, rather than beside every control: the
           * coin going in is the chain's own, so there is no allowance to grant
           * first and none left standing afterwards.
           */}
          <p className="mt-2 text-center text-[11px] text-faint">{t("snipe.oneSignature")}</p>

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

      <TargetSheet
        open={picking}
        pairs={listed}
        loading={loading}
        chosen={aimed}
        onPick={setAimed}
        onClose={() => setPicking(false)}
      />
    </div>
  );
}
