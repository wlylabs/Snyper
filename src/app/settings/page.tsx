"use client";

import { useState } from "react";
import { usePublicClient } from "wagmi";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useMounted } from "@/hooks/useMounted";
import { CHAIN_ID, CHAIN_META } from "@/lib/chains";
import { CURRENCIES, formatRate } from "@/lib/currency";
import { feePolicy, feeRouter, maxFeeBps, swapFeeBps } from "@/lib/fees";
import { LOCALES, type TKey } from "@/lib/i18n";
import { useI18n } from "@/hooks/useI18n";
import { useFxRate } from "@/hooks/useFxRate";
import { formatClock, timeAgo } from "@/lib/format";
import { RPC_OVERRIDE } from "@/lib/wagmi";
import { PRIVY_CONFIGURED } from "@/lib/privy";
import { PONS_V1_FACTORY, PONS_V2_FACTORY } from "@/lib/pons";
import { useVenue, useVenueDiscovery } from "@/hooks/useVenue";
import { truncateAddress } from "@/lib/format";
import { completeVenueConfig, type VenueConfig, type VenueSource } from "@/lib/venue";
import { DEFAULT_SETTINGS, useAppStore } from "@/store/useAppStore";

export default function SettingsPage() {
  const mounted = useMounted();
  const { t, locale } = useI18n();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  // Forced on: the reader is here to look at the rate, whichever currency is active.
  const { fx, isLoading: fxLoading } = useFxRate(true);
  const [wipeArmed, setWipeArmed] = useState(false);

  const wipe = () => {
    useAppStore.setState({
      snypes: [],
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

      </Panel>

      <FeesPanel />

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
            hint={t("settings.priorityFeeHint")}
            value={settings.priorityFeeGwei}
            min={0}
            max={500}
            onChange={(value) => setSettings({ priorityFeeGwei: value })}
          />
          <NumberField
            label={t("settings.maxImpact")}
            hint={t("settings.impactHint")}
            value={settings.maxImpactBps}
            min={0}
            max={9000}
            onChange={(value) => setSettings({ maxImpactBps: value })}
          />
        </div>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="check mt-0.5"
            checked={settings.autoDispatch}
            onChange={(event) => setSettings({ autoDispatch: event.target.checked })}
          />
          <span className="block text-[12px] font-semibold" title={t("settings.autoHint")}>
            {t("settings.autoLabel")}
          </span>
        </label>
      </Panel>

      <Panel label={t("settings.connectivity")} bodyClassName="p-3">
        <Row
          k={t("settings.privy")}
          v={
            mounted && PRIVY_CONFIGURED
              ? t("settings.configured")
              : t("settings.notConfigured")
          }
          tone={mounted && PRIVY_CONFIGURED ? "long" : "warn"}
        />
        <Row
          k={CHAIN_META[CHAIN_ID].label}
          v={
            mounted && RPC_OVERRIDE
              ? t("settings.privateEndpoint")
              : t("settings.publicEndpoint")
          }
        />
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
 * What this build charges, written down where a reader can check it against
 * what their wallet shows. A terminal that takes a cut and does not say so
 * anywhere is indistinguishable from one that is skimming, so the policy is
 * printed whether or not it is switched on.
 */
function FeesPanel() {
  const { t } = useI18n();
  const policy = feePolicy();
  const swapBps = swapFeeBps();
  const charging = Boolean(policy.recipient);
  const router = feeRouter();

  return (
    <Panel label={t("settings.fees")} bodyClassName="p-3">
      <Row
        k={t("settings.feeSwap")}
        v={swapBps > 0 ? `${swapBps / 100}%` : t("settings.feeNone")}
      />
      <Row
        k={t("settings.feeSnype")}
        v={
          charging && policy.profitShareBps > 0
            ? t("settings.feeProfitShare", { share: `${policy.profitShareBps / 100}%` })
            : t("settings.feeNone")
        }
      />
      {charging && <Row k={t("settings.feeCap")} v={`${maxFeeBps() / 100}%`} />}
      {charging && (
        <Row
          k={t("settings.feeVia")}
          v={router ? truncateAddress(router) : t("settings.feeViaDex")}
        />
      )}
      <p className="mt-3 text-[11px] leading-relaxed text-dim">
        {charging ? t("settings.feeNote") : t("settings.feeOff")}
      </p>
      {charging && !router && (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("settings.feeNoRouter")}</p>
      )}
    </Panel>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  /** What the number does, for a control whose name does not say. */
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block" title={hint}>
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

/** Label for each place a venue can have come from. */
const VENUE_SOURCE_KEY = {
  env: "settings.venueEnv",
  manual: "settings.venueManual",
  pons: "settings.venuePons",
  bundled: "settings.venueBundled",
} as const satisfies Record<VenueSource, TKey>;

/**
 * Where the routing venue came from, and a way to override it. The app asks the
 * Pons launchpad which DEX it opens its pools in and falls back to the
 * deployment it ships with, because Robinhood Chain publishes no list to resolve
 * against. These fields are for pointing the app somewhere else entirely, or at
 * a USD unit of your own.
 */
function VenuePanel() {
  const { t } = useI18n();
  const mounted = useMounted();
  const { venue } = useVenue();
  const { isResolving, retry: retryVenue } = useVenueDiscovery();
  const manual = useAppStore((state) => state.venueManual);
  const setVenueManual = useAppStore((state) => state.setVenueManual);
  const client = usePublicClient({ chainId: CHAIN_ID });
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<VenueConfig>(manual ?? {});

  /**
   * Stores what was typed, after asking the chain for whatever it leaves out.
   * The router knows its own factory and wrapped native, so the entry that gets
   * stored is the complete one rather than the partial one that would be
   * refused. What the reader typed always wins over what was read.
   */
  const saveManual = async () => {
    if (!client) {
      setVenueManual(draft);
      return;
    }
    setSaving(true);
    try {
      const completed = await completeVenueConfig(client, draft);
      setDraft(completed);
      setVenueManual(completed);
    } finally {
      setSaving(false);
    }
  };

  const sourceLabel = !venue
    ? isResolving
      ? t("settings.venueResolving")
      : t("settings.venueNone")
    : t(VENUE_SOURCE_KEY[venue.source]);

  return (
    <Panel label={t("settings.venue")} bodyClassName="p-3">
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

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-sm"
          data-busy={isResolving ? "true" : undefined}
          disabled={isResolving}
          onClick={retryVenue}
        >
          <Icon name="refresh" size={13} />
          {isResolving ? t("settings.venueResolving") : t("settings.venueRetry")}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen((value) => !value)}>
          <Icon name={open ? "chevron" : "sliders"} size={13} />
          {open ? t("common.close") : t("settings.venueEdit")}
        </button>
      </div>

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
              data-run={saving ? "true" : undefined}
              disabled={saving}
              onClick={() => void saveManual()}
            >
              {saving ? t("settings.venueResolving") : t("settings.venueSave")}
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
