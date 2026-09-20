"use client";

import { useAccount, useBlockNumber } from "wagmi";
import { chainMeta } from "@/lib/chains";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

/**
 * How often the head is asked for, for the readout below.
 *
 * Not the client's own interval, which viem derives from the chain's block time
 * and which chain 4663 makes 500ms — two `eth_blockNumber` calls a second, for
 * every open tab, forever, which is how a decorative number becomes the app's
 * heaviest caller and the first thing a rate limited endpoint refuses. A block
 * height on the status bar is there to show the chain is moving, and it shows
 * that just as well four seconds at a time.
 */
const HEAD_INTERVAL = 4000;

/**
 * The line under the header: whether a wallet is on the chain, and the chain's
 * own height. It used to carry armed strategies and a price marquee beside
 * them; both went with the surfaces that fed them, and nothing was invented to
 * fill the space they left.
 */
export function StatusStrip() {
  const mounted = useMounted();
  const { t } = useI18n();
  const { chainId, isConnected } = useAccount();
  const meta = chainMeta(chainId);
  const watching = mounted && isConnected && Boolean(meta);
  const { data: blockNumber } = useBlockNumber({
    watch: watching ? { poll: true, pollingInterval: HEAD_INTERVAL } : false,
    query: { enabled: watching },
  });

  return (
    <div className="sticky top-[var(--shell-top)] z-30 h-[var(--shell-strip)] border-b border-line bg-base/80 backdrop-blur">
      <div className="mx-auto flex h-full max-w-[1480px] items-center gap-4 overflow-hidden px-3 md:px-4">
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`dot ${watching ? "dot-live" : ""}`} />
          <span className="lbl">
            {mounted && isConnected ? t("common.connected") : t("common.idle")}
          </span>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="lbl">{meta ? meta.label : t("common.network")}</span>
          <span className="num text-[11px] text-dim">
            {mounted && blockNumber ? `#${blockNumber.toString()}` : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
