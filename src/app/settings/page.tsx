"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { InstallSheet } from "@/components/shell/InstallPrompt";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useMounted } from "@/hooks/useMounted";
import { CHAIN_META, SUPPORTED_CHAINS } from "@/lib/chains";
import { CURRENCIES, formatRate } from "@/lib/currency";
import { LOCALES } from "@/lib/i18n";
import { useI18n } from "@/hooks/useI18n";
import { useFxRate } from "@/hooks/useFxRate";
import { formatClock, timeAgo } from "@/lib/format";
import { WALLETCONNECT_PROJECT_ID } from "@/lib/wagmi";
import { DEFAULT_SETTINGS, useAppStore } from "@/store/useAppStore";

const RPC_ENV: Record<number, string | undefined> = {
  1: process.env.NEXT_PUBLIC_RPC_1,
  10: process.env.NEXT_PUBLIC_RPC_10,
  137: process.env.NEXT_PUBLIC_RPC_137,
  8453: process.env.NEXT_PUBLIC_RPC_8453,
  42161: process.env.NEXT_PUBLIC_RPC_42161,
  4663: process.env.NEXT_PUBLIC_RPC_4663,
};

export default function SettingsPage() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  // Forced on: the reader is here to look at the rate, whichever currency is active.
  const { fx, isLoading: fxLoading } = useFxRate(true);
  const { standalone } = useInstallPrompt();
  const [wipeArmed, setWipeArmed] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const wipe = () => {
    useAppStore.setState({
      bots: [],
      signals: [],
      trades: [],
      series: {},
      customTokens: [],
      discoveredTokens: [],
      settings: {
        ...DEFAULT_SETTINGS,
        locale: settings.locale,
        localeChosen: settings.localeChosen,
        currency: settings.currency,
        theme: settings.theme,
      },
    });
    setWipeArmed(false);
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <Panel label={t("settings.appearance")} bodyClassName="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{t("settings.theme")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{t("settings.themeHint")}</p>
          </div>
          <Segmented
            options={[
              { value: "dark", label: t("settings.dark") },
              { value: "light", label: t("settings.light") },
            ]}
            value={settings.theme}
            onChange={(value) => setSettings({ theme: value })}
          />
        </div>

        <div className="my-3 hair" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">{t("settings.language")}</p>
            <p className="mt-0.5 text-[11px] text-faint">{t("settings.languageHint")}</p>
          </div>
          <Segmented
            options={LOCALES}
            value={settings.locale}
            onChange={(value) => setSettings({ locale: value, localeChosen: true })}
          />
        </div>
      </Panel>

      <Panel label={t("settings.currency")} bodyClassName="p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-faint">
            {t("settings.currencyHint")}
          </p>
          <Segmented
            options={CURRENCIES}
            value={settings.currency}
            onChange={(value) => setSettings({ currency: value })}
          />
        </div>

        <div className="mt-3">
          {fx ? (
            <>
              <Row k={t("settings.fxRate")} v={`Rp ${formatRate(fx.rate, locale)}`} />
              <Row
                k={t("settings.fxUpdated")}
                v={`${formatClock(fx.updatedAt)} · ${t("common.ago", {
                  value: timeAgo(fx.updatedAt),
                })}`}
              />
              <Row k={t("settings.fxSource")} v={fx.source} />
            </>
          ) : (
            <Row
              k={t("settings.fxRate")}
              v={fxLoading ? "…" : t("settings.fxUnavailable")}
              tone={fxLoading ? undefined : "warn"}
            />
          )}
        </div>

        <p className="mt-3 text-[10px] leading-relaxed text-faint">{t("settings.fxNote")}</p>
      </Panel>

      <Panel label={t("settings.execDefaults")} bodyClassName="p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label={t("settings.slippage")}
            value={settings.slippageBps}
            min={1}
            max={1000}
            onChange={(value) => setSettings({ slippageBps: value })}
          />
          <NumberField
            label={t("settings.deadline")}
            value={settings.deadlineMinutes}
            min={1}
            max={180}
            onChange={(value) => setSettings({ deadlineMinutes: value })}
          />
          <NumberField
            label={t("settings.tick")}
            value={settings.tickSeconds}
            min={10}
            max={600}
            onChange={(value) => setSettings({ tickSeconds: value })}
          />
        </div>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="check mt-0.5"
            checked={settings.autoDispatch}
            onChange={(event) => setSettings({ autoDispatch: event.target.checked })}
          />
          <span>
            <span className="block text-[12px] font-semibold">{t("settings.autoLabel")}</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-faint">
              {t("settings.autoHint")}
            </span>
          </span>
        </label>
      </Panel>

      <Panel label={t("settings.install")} bodyClassName="p-3">
        {mounted && standalone ? (
          <p className="flex items-center gap-2 text-[12px] long">
            <Icon name="check" size={14} />
            {t("settings.installed")}
          </p>
        ) : (
          <>
            <p className="text-[11px] leading-relaxed text-dim">
              {t("settings.installIntro")}
            </p>
            <button
              type="button"
              className="btn btn-accent btn-sm mt-3 w-full"
              onClick={() => setInstallOpen(true)}
            >
              <Icon name="download" size={13} />
              {t("settings.installAction")}
            </button>
          </>
        )}
        <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      </Panel>

      <Panel label={t("settings.connectivity")} bodyClassName="p-3">
        <Row
          k={t("settings.walletConnect")}
          v={
            mounted && WALLETCONNECT_PROJECT_ID
              ? t("settings.configured")
              : t("settings.notConfigured")
          }
          tone={mounted && WALLETCONNECT_PROJECT_ID ? "long" : "warn"}
        />
        {SUPPORTED_CHAINS.map((chain) => (
          <Row
            key={chain.id}
            k={CHAIN_META[chain.id].label}
            v={
              RPC_ENV[chain.id]
                ? t("settings.privateEndpoint")
                : t("settings.publicEndpoint")
            }
          />
        ))}
        <p className="wrap-any mt-3 text-[10px] leading-relaxed text-faint">
          {t("settings.rpcNote")}
        </p>
      </Panel>

      <Panel label={t("settings.localData")} bodyClassName="p-3">
        <p className="text-[11px] leading-relaxed text-dim">{t("settings.localDataNote")}</p>
        <button
          type="button"
          className="btn btn-short btn-sm mt-3 w-full"
          onClick={() => (wipeArmed ? wipe() : setWipeArmed(true))}
        >
          <Icon name={wipeArmed ? "alert" : "trash"} size={13} />
          {wipeArmed ? t("settings.clearConfirm") : t("settings.clear")}
        </button>
      </Panel>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="lbl mb-1.5 block">{label}</span>
      <input
        className="field"
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
      />
    </label>
  );
}
