"use client";

import { Icon } from "@/components/ui/Icon";
import { Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { useI18n } from "@/hooks/useI18n";
import { useMounted } from "@/hooks/useMounted";
import { LOCALES } from "@/lib/i18n";
import { DEFAULT_SETTINGS, useAppStore } from "@/store/useAppStore";

/**
 * The settings the app still has, which is what it looks like and what language
 * it speaks. Both are also one press away in the header — this is where they are
 * named and explained, rather than a second place to reach them.
 *
 * Nothing renders before mount: every control here reflects stored state, and a
 * segmented control marking the wrong option for a frame is worse than one that
 * arrives a frame late.
 */
export default function SettingsPage() {
  const mounted = useMounted();
  const { t } = useI18n();
  const toast = useToast();
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
      </Panel>

      <Panel label={t("settings.localData")} bodyClassName="p-3">
        <p className="text-[11px] leading-relaxed text-dim">{t("settings.localDataNote")}</p>
        <button
          type="button"
          className="btn btn-sm mt-3 w-full"
          onClick={() => {
            // Back to the defaults, which includes following the browser's own
            // language again — that is what a reader resetting this is asking for.
            setSettings(DEFAULT_SETTINGS);
            toast.push({ tone: "info", message: t("settings.resetDone") });
          }}
        >
          <Icon name="refresh" size={13} />
          {t("settings.reset")}
        </button>
      </Panel>
    </div>
  );
}
