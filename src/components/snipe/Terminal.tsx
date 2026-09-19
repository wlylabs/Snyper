"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel, Row, Skeleton } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CHAIN_ID, chainMeta, explorerTx } from "@/lib/chains";
import { formatAmount, formatCompact } from "@/lib/format";
import { CEILING, FLOOR } from "@/lib/screener";
import {
  EXITS,
  SLIPPAGE_FLOOR,
  SNIPE_CEILING,
  VENUE,
  floorFor,
  slippageCapped,
  snipeSlippageFor,
} from "@/lib/venue";
import { useConnectPrompt } from "@/hooks/useConnectPrompt";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { useScreener, type Pair } from "@/hooks/useScreener";
import { STAKES, useFire, useShot } from "@/hooks/useSnipe";
import { useRoutes, useSwapAction } from "@/hooks/useSwap";

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

function stakeLabel(stake: bigint): string {
  return formatAmount(Number(formatEther(stake)));
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
function Exit({ pair }: { pair: Pair }) {
  const { t } = useI18n();
  const { address } = useAccount();

  const { data: balance, refetch } = useReadContract({
    address: pair.token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const position = balance ?? 0n;
  const reread = useCallback(() => void refetch(), [refetch]);
  const { bestFor, tradable } = useRoutes(position > 0n ? pair.token : undefined, position);

  /* The pair's own quote first; anything else only if that pool will not take it. */
  const chosen =
    tradable.find(
      (option) => option.address.toLowerCase() === pair.quoteToken.toLowerCase(),
    ) ?? tradable[0];
  const route = chosen ? bestFor(chosen) : undefined;
  /*
   * The terminal's ceiling on both sides, and it has to be the same one. A
   * screen that lets a reader buy into a pool at fifteen percent and then
   * refuses to sell them out of it at five has not protected them from
   * anything — it has built the trap the exit check exists to find.
   */
  const slippage = route ? snipeSlippageFor(route.impactBps) : SLIPPAGE_FLOOR;
  const costly = route !== undefined && route.impactBps >= COSTLY;
  const capped = route !== undefined && slippageCapped(route.impactBps);

  const { approved, approve, approving, send, sending, done, blocked, checking } = useSwapAction({
    token: pair.token,
    route,
    amountIn: position,
    slippageBps: slippage,
    /*
     * Stable, and it has to be: the hook fires this from an effect that keeps
     * the callback in its dependencies, so a fresh closure every render would
     * refetch, re-render and fire it again for as long as the receipt stood.
     */
    onDone: reread,
  });

  if (position === 0n) return null;

  const units = (value: bigint, exit: (typeof EXITS)[number] | undefined) =>
    exit ? `${formatAmount(Number(formatUnits(value, exit.decimals)))} ${exit.symbol}` : "—";

  return (
    <Panel className="mt-3" label={t("snipe.position")}>
      <Row
        k={t("snipe.held")}
        v={
          <span className="num">
            {`${formatAmount(Number(formatUnits(position, pair.decimals)))} ${pair.symbol}`}
          </span>
        }
      />
      <Row
        k={t("snipe.youGet")}
        v={<span className="num">{route ? units(route.amountOut, chosen) : "—"}</span>}
      />
      <Row
        k={t("snipe.atLeast")}
        v={
          <span className="num">
            {route ? units(floorFor(route.amountOut, slippage), chosen) : "—"}
          </span>
        }
      />

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
  const [stake, setStake] = useState<bigint>(STAKES[0]);

  const listed = useMemo(() => targets(pairs), [pairs]);

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
  const { fire, firing, done, hash, short, checking, blocked, failure, ready, reset } = useFire({
    pair: target,
    stake,
    shot,
  });

  const coin = chainMeta(CHAIN_ID)?.nativeName ?? "ETH";
  const hops = target && target.quoteToken.toLowerCase() === VENUE.wrapped.toLowerCase() ? 1 : 2;

  /* A new target or a new size is a new shot; the last one's receipt is not it. */
  useEffect(() => {
    reset();
  }, [aimed, stake, reset]);

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
          <p className="lbl mt-3 mb-1.5">{t("snipe.stake", { coin })}</p>
          <Segmented
            options={STAKES.map((size) => ({ value: String(size), label: stakeLabel(size) }))}
            value={String(stake)}
            onChange={(value) => setStake(BigInt(value))}
          />

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
            {/*
             * The exit is a row of its own rather than a footnote, because it is
             * the only number here that is about the token rather than about the
             * trade. Anything under the whole stake is the pool's fees on the way
             * out and back; anything far under it is the pool telling the reader
             * what leaving will cost.
             */}
            <Row
              k={t("snipe.exit")}
              v={
                <span className="num">
                  {shot?.trapped
                    ? t("snipe.exitNone")
                    : shot?.roundTrip !== undefined
                      ? t("snipe.exitBack", { percent: formatAmount(Number((shot.roundTrip * 100).toFixed(1))) })
                      : "—"}
                </span>
              }
              tone={
                shot?.trapped
                  ? "short"
                  : shot?.roundTrip !== undefined && shot.roundTrip < 0.9
                    ? "warn"
                    : undefined
              }
            />
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
            <button
              type="button"
              className="btn btn-accent mt-2 w-full"
              disabled={!ready || firing || checking || quoting || shot?.trapped}
              onClick={fire}
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

      {target && address && <Exit pair={target} />}

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
