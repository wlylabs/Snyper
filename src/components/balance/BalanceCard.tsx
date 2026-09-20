"use client";

import { useState } from "react";
import { Figure } from "@/components/ui/Figure";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { WalletAvatar } from "@/components/ui/WalletAvatar";
import { CHAIN_ID, chainMeta } from "@/lib/chains";
import { formatAmount, truncateAddress, usd } from "@/lib/format";
import { useI18n } from "@/hooks/useI18n";
import type { Holding } from "@/hooks/useHoldings";
import { useAppStore } from "@/store/useAppStore";

/**
 * What a dollar figure reads as while the reader has the screen covered.
 *
 * A fixed run rather than one dot per digit, and every covered figure on the
 * screen is the same width. A mask that tracked the length would hand back the
 * magnitude of every holding — which is most of what somebody covering their
 * balance in a room with other people in it is covering.
 */
export const COVERED = "••••••";

type Native = { symbol: string; formatted: string } | undefined;

/**
 * The balance screen's answer, on a card.
 *
 * Every wallet app this one will be read next to opens on one: Rainbow,
 * Uniswap, MetaMask, and the shadcn and beUI wallet blocks people build from
 * all put the total on its own surface, at the top, in the largest type on the
 * screen, with the account it belongs to beside it and the account's actions
 * under it. The fintech dashboards say the same thing in more words — the
 * top-of-page figure is the "am I okay" answer, and everything below it is
 * detail the reader asked for.
 *
 * What it does not take from them is a surface. The card is the Snyper mark
 * at card scale — four brackets and nothing inside them — so the figure sits
 * on the page's own ground rather than on a panel. See `.saldo` in
 * `globals.css` for how the frame is drawn.
 *
 * What the pattern does not get here is a 24-hour change pill, which every one
 * of those references carries. This app cannot know it: nothing stores what
 * this wallet was worth yesterday, and the change pill is the single most
 * copied element of the pattern precisely because it is the one a reader trusts
 * without checking. So the card carries what is true instead — what the figure
 * is made of, and what it had to leave out.
 */
export function BalanceCard({
  address,
  total,
  native,
  nativeValue,
  holdings,
  verifying,
  onRefresh,
}: {
  address: `0x${string}`;
  /** The priced total, or undefined when nothing on this screen has a price. */
  total: number | undefined;
  native: Native;
  nativeValue: number | undefined;
  holdings: Holding[];
  /** True while the chain is being asked to confirm what the index reported. */
  verifying: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const covered = useAppStore((state) => Boolean(state.settings.masked));
  const setSettings = useAppStore((state) => state.setSettings);
  const [copied, setCopied] = useState(false);

  const meta = chainMeta(CHAIN_ID);
  const listed = holdings.filter((row) => !row.hidden);
  /*
   * What the total left out. `useHoldings` sums only what something priced, and
   * on this chain two thirds of what a wallet holds has no price at all — so a
   * card that printed the figure and stopped would be quietly under-reporting a
   * wallet with no way for the reader to tell. Saying how many is the smallest
   * honest version of that, and it costs a line.
   */
  const unpriced = listed.filter((row) => row.value === undefined).length;
  const coin = native && Number(native.formatted) > 0 ? native : undefined;
  const assets = listed.length + (coin ? 1 : 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="saldo mb-3">
      <header className="saldo-head">
        <WalletAvatar address={address} size={26} />
        {/*
         * The address is the control rather than something sitting next to one.
         * It is the only copyable thing on the card, and a reader reaching for
         * it is already pointing at it.
         */}
        <button
          type="button"
          className="group flex min-w-0 items-center gap-1.5"
          onClick={copy}
          aria-label={copied ? t("common.copied") : t("common.copy")}
        >
          <span className="num truncate text-[12px] text-dim">
            {truncateAddress(address, 6, 4)}
          </span>
          <Icon
            key={copied ? "check" : "copy"}
            name={copied ? "check" : "copy"}
            size={12}
            className={`pop shrink-0 ${copied ? "text-accent-text" : "text-faint"}`}
          />
        </button>

        <span className="chip ml-auto shrink-0">{meta?.mark ?? t("common.network")}</span>

        <IconButton
          icon={covered ? "hide" : "eye"}
          size={14}
          onClick={() => setSettings({ masked: !covered })}
          aria-pressed={covered}
          title={covered ? t("balance.unmask") : t("balance.mask")}
          aria-label={covered ? t("balance.unmask") : t("balance.mask")}
        />
        <IconButton
          icon="refresh"
          act="spin"
          size={14}
          busy={verifying}
          onClick={onRefresh}
          title={t("balance.reread")}
          aria-label={t("balance.reread")}
        />
      </header>

      <div className="saldo-face">
        {/* The label does not change with the cover. What is covered is worth
            saying only if the reader can still see what it was a figure of. */}
        <p className="lbl">{t("balance.total")}</p>
        <p
          className="num saldo-figure mt-2.5"
          data-covered={covered ? "true" : undefined}
          /*
           * The cover is a display state, not a state of the money: the figure
           * itself stays out of the accessibility tree while it is on, rather
           * than being read aloud as six bullets.
           */
          aria-label={covered ? t("balance.covered") : undefined}
        >
          <Figure value={covered ? COVERED : usd(total)} pending={verifying} />
        </p>
        {/* Not covered with the figure above it. This is a count of contracts,
            which the explorer gives away anyway, and it is the line that says
            the figure is incomplete — worth more under the cover than over it,
            and it keeps the card the same height either way. */}
        {unpriced > 0 && (
          <p className="mt-2.5 text-[11px] text-faint">
            {t("balance.unpriced", { count: unpriced })}
          </p>
        )}
      </div>

      <div className="saldo-foot">
        {/*
         * Gas first, because it is the one holding on this screen that stops a
         * trade rather than being one. A reader whose transaction will not sign
         * is looking for this number.
         */}
        <div className="saldo-cell">
          <p className="lbl">{t("balance.gas")}</p>
          <p className="num mt-1.5 truncate text-[13px]">
            <Figure
              value={
                coin
                  ? covered
                    ? COVERED
                    : `${formatAmount(Number(coin.formatted), 5)} ${coin.symbol}`
                  : "—"
              }
            />
          </p>
          <p className="num mt-1 text-[11px] text-faint">
            <Figure value={covered && nativeValue !== undefined ? COVERED : usd(nativeValue)} />
          </p>
        </div>

        {/*
         * A count is not money, so it is not covered with the rest — how many
         * contracts an address holds is on the explorer either way, and blanking
         * it would only cost the reader the one figure on the card that tells
         * them the list below finished loading.
         */}
        <div className="saldo-cell">
          <p className="lbl">{t("balance.assets")}</p>
          <p className="num mt-1.5 text-[13px]">
            <Figure value={String(assets)} />
          </p>
          <p className="mt-1 truncate text-[11px] text-faint">
            {meta?.label ?? t("common.network")}
          </p>
        </div>
      </div>
    </section>
  );
}
