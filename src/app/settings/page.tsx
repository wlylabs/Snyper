"use client";

import { ReferralPanel } from "@/components/settings/ReferralPanel";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { LOCALES } from "@/lib/i18n";
import type { Currency } from "@/lib/format";
import { useAppStore } from "@/store/useAppStore";

/** Currency codes need no translation — they are the same word everywhere. */
const CURRENCIES: { value: Currency; label: string }[] = [
  { value: "USD", label: "USD" },
  { value: "IDR", label: "IDR" },
];

/**
 * The settings the app still has — what it looks like, what language it
 * speaks, and which currency a dollar figure is shown as. All three live here
 * and nowhere else — the header carried a pair of keys for a while, and a
 * switch in two places is one place too many for a setting a reader touches
 * once.
 *
 * Nothing renders before mount: every control here reflects stored state, and a
 * segmented control marking the wrong option for a frame is worse than one that
 * arrives a frame late.
 */
export default function SettingsPage() {
  const mounted = useMounted();
  const { t } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);

  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <div className="mb-1">
        <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">
          {t("settings.title")}
        </h1>
        <p className="mt-0.5 text-[11px] text-faint">{t("settings.subtitle")}</p>
      </div>

      <Panel label={t("settings.appearance")} bodyClassName="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{t("settings.theme")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{t("settings.themeHint")}</p>
          </div>
          {mounted ? (
            <Segmented
              options={[
                { value: "dark", label: t("settings.dark") },
                { value: "light", label: t("settings.light") },
              ]}
              value={settings.theme}
              onChange={(value) => setSettings({ theme: value })}
            />
          ) : (
            <div className="skel h-[34px] w-[132px]" />
          )}
        </div>

        <div className="my-3 hair" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{t("settings.language")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{t("settings.languageHint")}</p>
          </div>
          {mounted ? (
            <Segmented
              options={LOCALES}
              value={settings.locale}
              // An explicit choice ends the browser-language detection in `providers`.
              onChange={(value) => setSettings({ locale: value, localeChosen: true })}
            />
          ) : (
            <div className="skel h-[34px] w-[168px]" />
          )}
        </div>

        <div className="my-3 hair" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{t("settings.currency")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{t("settings.currencyHint")}</p>
          </div>
          {mounted ? (
            <Segmented
              options={CURRENCIES}
              // A setting from before this field existed reads as `undefined` — see `useMoney`.
              value={settings.currency ?? "USD"}
              onChange={(value) => setSettings({ currency: value })}
            />
          ) : (
            <div className="skel h-[34px] w-[104px]" />
          )}
        </div>
      </Panel>

      <ReferralPanel />
    </div>
  );
}
