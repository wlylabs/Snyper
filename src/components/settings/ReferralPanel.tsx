"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { useI18n } from "@/hooks/useI18n";

/**
 * The one place the app asks for something back: a referral link out to Fomo,
 * where the reader trades what Snyper does not list. It sits at the foot of
 * settings rather than in the header or the rail — an ask belongs on the screen
 * a reader opens on purpose, not on the one they fire a shot from.
 *
 * Both keys are the app's own: the link opens in its own tab, and the copy
 * carries the sentence with it, because a bare URL pasted into a chat says
 * nothing about why anyone should open it.
 */
const REFERRAL_URL = "https://fomo.family/r/snyper";
const REFERRAL_PITCH = "Trade with me on fomo and get 10% off fees!";
/** What the address bar would show — the scheme is noise at this size. */
const REFERRAL_LABEL = "fomo.family/r/snyper";

export function ReferralPanel() {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  // The tick is a timed state, and a component unmounted mid-tick must not
  // come back to set it.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${REFERRAL_PITCH}\n${REFERRAL_URL}`);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel label={t("settings.referral")} bodyClassName="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[12px] font-semibold">{t("settings.referralTitle")}</p>
        <span className="chip chip-xs chip-live">{t("settings.referralBadge")}</span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        {t("settings.referralHint")}
      </p>

      <p className="num mt-3 flex items-center gap-2 truncate text-[11px] text-dim">
        <Icon name="link" size={13} className="shrink-0 text-faint" />
        <span className="truncate">{REFERRAL_LABEL}</span>
      </p>

      {/*
       * The pair of keys is capped rather than stretched: this panel shares a
       * 3xl page with two segmented controls, and a key run the full width of
       * it would be the widest thing on the screen for the smallest ask on it.
       */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-[420px]">
        <a
          href={REFERRAL_URL}
          target="_blank"
          rel="noreferrer"
          className="btn btn-accent"
        >
          <Icon name="external" size={14} />
          {t("settings.referralOpen")}
        </a>
        {/*
         * The confirmation stays on the key that did the work, the way the
         * account sheet's copy does: the tick lands where the clipboard glyph
         * was, and drops away on its own.
         */}
        <button
          type="button"
          className="btn"
          data-done={copied ? "true" : undefined}
          onClick={() => void copy()}
        >
          <Icon
            key={copied ? "check" : "copy"}
            name={copied ? "check" : "copy"}
            size={14}
            className={`pop ${copied ? "text-accent-text" : ""}`}
          />
          {copied ? t("common.copied") : t("settings.referralCopy")}
        </button>
      </div>
    </Panel>
  );
}
