"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { InstallSheet } from "@/components/shell/InstallPrompt";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useMounted } from "@/hooks/useMounted";
import { CHAIN_ID, CHAIN_META } from "@/lib/chains";
import { CURRENCIES, formatRate } from "@/lib/currency";
import { LOCALES } from "@/lib/i18n";
import { useI18n } from "@/hooks/useI18n";
import { useFxRate } from "@/hooks/useFxRate";
import { formatClock, timeAgo } from "@/lib/format";
import { RPC_OVERRIDE, WALLETCONNECT_PROJECT_ID } from "@/lib/wagmi";
import { PONS_V1_FACTORY, PONS_V2_FACTORY } from "@/lib/pons";
import { useVenue, useVenueDiscovery } from "@/hooks/useVenue";
import { truncateAddress } from "@/lib/format";
import type { VenueConfig } from "@/lib/venue";
import { DEFAULT_SETTINGS, useAppStore } from "@/store/useAppStore";

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
          <NumberField
            label={t("settings.priorityFee")}
            value={settings.priorityFeeGwei}
            min={0}
            max={500}
            onChange={(value) => setSettings({ priorityFeeGwei: value })}
          />
          <NumberField
            label={t("settings.maxImpact")}
            value={settings.maxImpactBps}
            min={0}
            max={9000}
            onChange={(value) => setSettings({ maxImpactBps: value })}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-faint">
          {t("settings.guardNote")}
        </p>
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

      <Panel label={t("settings.presets")} bodyClassName="p-3">
        <p className="text-[11px] leading-relaxed text-faint">{t("settings.presetsNote")}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PresetField
            label={t("settings.presetsNative")}
            values={settings.presetsNative}
            onChange={(presetsNative) => setSettings({ presetsNative })}
          />
          <PresetField
            label={t("settings.presetsStable")}
            values={settings.presetsStable}
            onChange={(presetsStable) => setSettings({ presetsStable })}
          />
        </div>
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
        <Row
          k={CHAIN_META[CHAIN_ID].label}
          v={
            mounted && RPC_OVERRIDE
              ? t("settings.privateEndpoint")
              : t("settings.publicEndpoint")
          }
        />
        <p className="wrap-any mt-3 text-[10px] leading-relaxed text-faint">
          {t("settings.rpcNote")}
        </p>
      </Panel>

      <VenuePanel />

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

/**
 * Preset sizes as one comma separated line. Anything that is not a positive
 * number is dropped rather than stored, so a half-typed list cannot end up on a
 * buy button.
 */
function PresetField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: number[];
  onChange: (values: number[]) => void;
}) {
  const [draft, setDraft] = useState(values.join(", "));

  const commit = (text: string) => {
    const parsed = text
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 6);
    onChange(parsed);
  };

  return (
    <label className="block">
      <span className="lbl mb-1.5 block">{label}</span>
      <input
        className="field num"
        inputMode="decimal"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
      />
    </label>
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

/**
 * Where the routing venue came from, and a way to override it. The app resolves
 * Uniswap's addresses by asking the Pons launchpad which DEX it opens its pools
 * in, because Robinhood Chain ships no deployment list worth bundling. What the
 * launchpad cannot answer — a QuoterV2 for exact pricing, a USD unit to value a
 * portfolio against — is what these fields are for.
 */
function VenuePanel() {
  const { t } = useI18n();
  const mounted = useMounted();
  const { venue } = useVenue();
  const { isResolving } = useVenueDiscovery();
  const manual = useAppStore((state) => state.venueManual);
  const setVenueManual = useAppStore((state) => state.setVenueManual);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<VenueConfig>(manual ?? {});

  const sourceLabel = !venue
    ? isResolving
      ? t("settings.venueResolving")
      : t("settings.venueNone")
    : venue.source === "env"
      ? t("settings.venueEnv")
      : venue.source === "manual"
        ? t("settings.venueManual")
        : t("settings.venuePons");

  return (
    <Panel label={t("settings.venue")} bodyClassName="p-3">
      <p className="text-[11px] leading-relaxed text-dim">{t("settings.venueNote")}</p>

      <div className="mt-3">
        <Row
          k={t("settings.venueSource")}
          v={mounted ? sourceLabel : "…"}
          tone={mounted && !venue ? "warn" : undefined}
        />
        <Row
          k={t("settings.venueRouter")}
          v={venue ? truncateAddress(venue.router, 8, 6) : "—"}
        />
        <Row
          k={t("settings.venueFactory")}
          v={venue ? truncateAddress(venue.factory, 8, 6) : "—"}
        />
        <Row
          k={t("settings.venueWrapped")}
          v={venue ? `${venue.wrappedSymbol} · ${truncateAddress(venue.wrapped, 6, 4)}` : "—"}
        />
        <Row
          k={t("settings.venueQuoter")}
          v={venue?.quoter ? truncateAddress(venue.quoter, 8, 6) : t("settings.venueEstimating")}
          tone={venue && !venue.quoter ? "warn" : undefined}
        />
        <Row
          k={t("settings.venueStable")}
          v={
            venue?.stable
              ? `${venue.stableSymbol} · ${truncateAddress(venue.stable, 6, 4)}`
              : t("common.none")
          }
        />
      </div>

      <div className="mt-3">
        <Row k={t("settings.ponsV1")} v={truncateAddress(PONS_V1_FACTORY, 8, 6)} />
        <Row k={t("settings.ponsV2")} v={truncateAddress(PONS_V2_FACTORY, 8, 6)} />
      </div>

      <button
        type="button"
        className="btn btn-sm mt-3 w-full"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? "chevron" : "sliders"} size={13} />
        {open ? t("common.close") : t("settings.venueEdit")}
      </button>

      {open && (
        <div className="mt-3 grid gap-2">
          <AddressField
            label={t("settings.venueFactory")}
            value={draft.factory ?? ""}
            onChange={(factory) => setDraft((d) => ({ ...d, factory }))}
          />
          <AddressField
            label={t("settings.venueRouter")}
            value={draft.router ?? ""}
            onChange={(router) => setDraft((d) => ({ ...d, router }))}
          />
          <AddressField
            label={t("settings.venueWrapped")}
            value={draft.wrapped ?? ""}
            onChange={(wrapped) => setDraft((d) => ({ ...d, wrapped }))}
          />
          <AddressField
            label={t("settings.venueQuoter")}
            value={draft.quoter ?? ""}
            onChange={(quoter) => setDraft((d) => ({ ...d, quoter }))}
          />
          <AddressField
            label={t("settings.venueStable")}
            value={draft.stable ?? ""}
            onChange={(stable) => setDraft((d) => ({ ...d, stable }))}
          />
          <div className="grid grid-cols-2 gap-2">
            <AddressField
              label={t("settings.venueStableSymbol")}
              value={draft.stableSymbol ?? ""}
              onChange={(stableSymbol) => setDraft((d) => ({ ...d, stableSymbol }))}
            />
            <AddressField
              label={t("settings.venueStableDecimals")}
              value={String(draft.stableDecimals ?? "")}
              onChange={(stableDecimals) => setDraft((d) => ({ ...d, stableDecimals }))}
            />
          </div>

          <p className="text-[10px] leading-relaxed warn">{t("settings.venueWarning")}</p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => setVenueManual(draft)}
            >
              {t("settings.venueSave")}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setDraft({});
                setVenueManual(undefined);
              }}
            >
              {t("settings.venueClear")}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function AddressField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="lbl mb-1 block">{label}</span>
      <input
        className="field num"
        value={value}
        placeholder="0x…"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
