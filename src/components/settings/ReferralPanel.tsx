"use client";

import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { useI18n } from "@/hooks/useI18n";

/**
 * The one place the app asks for something back: a referral link out to Fomo,
 * where the reader trades what Snyper does not list. It sits at the foot of
 * settings rather than in the header or the rail — an ask belongs on the screen
 * a reader opens on purpose, not on the one they fire a shot from.
 *
 * One key, and the address it opens printed above it. An ask this small is
 * worth a single unambiguous door rather than a row of them.
 */
const REFERRAL_URL = "https://fomo.family/r/snyper";
/** What the address bar would show — the scheme is noise at this size. */
const REFERRAL_LABEL = "fomo.family/r/snyper";

export function ReferralPanel() {
  const { t } = useI18n();

  return (
    <Panel
      label={t("settings.referral")}
      /*
       * The discount rides in the panel head rather than beside the line that
       * invites: it is the one number on the card, and a figure read before the
       * sentence is a figure the sentence no longer has to argue for.
       */
      meta={<span className="chip chip-xs chip-live">{t("settings.referralBadge")}</span>}
      bodyClassName="p-3"
    >
      <p className="text-[12px] font-semibold">{t("settings.referralTitle")}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-faint">
        {t("settings.referralHint")}
      </p>

      <p className="num mt-3 flex items-center gap-2 truncate text-[11px] text-dim">
        <Icon name="link" size={13} className="shrink-0 text-faint" />
        <span className="truncate">{REFERRAL_LABEL}</span>
      </p>

      {/*
       * The key is capped rather than stretched: this panel shares a 3xl page
       * with two segmented controls, and a key run the full width of it would
       * be the widest thing on the screen for the smallest ask on it. On a
       * phone it takes the column, where every other key in the app does.
       */}
      <a
        href={REFERRAL_URL}
        target="_blank"
        rel="noreferrer"
        className="btn btn-accent mt-3 w-full sm:w-auto sm:min-w-[206px]"
      >
        <Icon name="external" size={14} />
        {t("settings.referralOpen")}
      </a>
    </Panel>
  );
}
