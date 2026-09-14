"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Panel, Row } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useMounted } from "@/hooks/useMounted";
import { CHAIN_META, SUPPORTED_CHAINS } from "@/lib/chains";
import { WALLETCONNECT_PROJECT_ID } from "@/lib/wagmi";
import { DEFAULT_SETTINGS, useAppStore } from "@/store/useAppStore";

const RPC_ENV: Record<number, string | undefined> = {
  1: process.env.NEXT_PUBLIC_RPC_1,
  10: process.env.NEXT_PUBLIC_RPC_10,
  137: process.env.NEXT_PUBLIC_RPC_137,
  8453: process.env.NEXT_PUBLIC_RPC_8453,
  42161: process.env.NEXT_PUBLIC_RPC_42161,
};

export default function SettingsPage() {
  const mounted = useMounted();
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const { canInstall, install, standalone, ios } = useInstallPrompt();
  const [wipeArmed, setWipeArmed] = useState(false);

  const wipe = () => {
    useAppStore.setState({
      bots: [],
      signals: [],
      trades: [],
      series: {},
      customTokens: [],
      settings: DEFAULT_SETTINGS,
    });
    setWipeArmed(false);
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-3">
      <Panel label="Appearance" bodyClassName="p-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[12px] font-semibold">Theme</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Applied instantly and remembered on this device.
            </p>
          </div>
          <Segmented
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
            value={settings.theme}
            onChange={(value) => setSettings({ theme: value })}
          />
        </div>
      </Panel>

      <Panel label="Execution defaults" bodyClassName="p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Slippage (bps)"
            value={settings.slippageBps}
            min={1}
            max={1000}
            onChange={(value) => setSettings({ slippageBps: value })}
          />
          <NumberField
            label="Deadline (min)"
            value={settings.deadlineMinutes}
            min={1}
            max={180}
            onChange={(value) => setSettings({ deadlineMinutes: value })}
          />
          <NumberField
            label="Engine tick (sec)"
            value={settings.tickSeconds}
            min={10}
            max={600}
            onChange={(value) => setSettings({ tickSeconds: value })}
          />
        </div>
        <label className="mt-4 flex items-start gap-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            checked={settings.autoDispatch}
            onChange={(event) => setSettings({ autoDispatch: event.target.checked })}
          />
          <span>
            <span className="block text-[12px] font-semibold">Auto-submit strategy signals</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-faint">
              Applies only to strategies set to auto. Every transaction is still signed in your
              wallet — Snyper holds no keys and cannot move funds on its own.
            </span>
          </span>
        </label>
      </Panel>

      <Panel label="Install" bodyClassName="p-3">
        {standalone ? (
          <p className="flex items-center gap-2 text-[12px] long">
            <Icon name="check" size={14} />
            Running as an installed app.
          </p>
        ) : canInstall ? (
          <>
            <p className="text-[11px] leading-relaxed text-dim">
              Install Snyper to run it fullscreen with its own launcher entry. It keeps working
              offline for anything already cached; live prices still need a connection.
            </p>
            <button type="button" className="btn btn-accent btn-sm mt-3 w-full" onClick={() => void install()}>
              <Icon name="download" size={13} />
              Install app
            </button>
          </>
        ) : ios ? (
          <p className="text-[11px] leading-relaxed text-dim">
            On iOS: open the share sheet in Safari and choose{" "}
            <span className="font-semibold">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-[11px] leading-relaxed text-dim">
            Your browser has not offered an install prompt yet. Chromium browsers surface it
            after a short visit; desktop Chrome also shows an install icon in the address bar.
          </p>
        )}
      </Panel>

      <Panel label="Connectivity" bodyClassName="p-3">
        <Row
          k="WalletConnect"
          v={mounted && WALLETCONNECT_PROJECT_ID ? "Configured" : "Not configured"}
          tone={mounted && WALLETCONNECT_PROJECT_ID ? "long" : "warn"}
        />
        {SUPPORTED_CHAINS.map((chain) => (
          <Row
            key={chain.id}
            k={CHAIN_META[chain.id].label}
            v={RPC_ENV[chain.id] ? "Private endpoint" : "Public endpoint"}
          />
        ))}
        <p className="mt-3 text-[10px] leading-relaxed text-faint">
          Endpoints are set at build time through NEXT_PUBLIC_RPC_&lt;chainId&gt;. Public
          fallbacks rate-limit quickly under a fast engine tick.
        </p>
      </Panel>

      <Panel label="Local data" bodyClassName="p-3">
        <p className="text-[11px] leading-relaxed text-dim">
          Strategies, signals, the activity ledger and recorded price ticks live in this
          browser only. Clearing them cannot be undone and does not touch anything on-chain.
        </p>
        <button
          type="button"
          className="btn btn-short btn-sm mt-3 w-full"
          onClick={() => (wipeArmed ? wipe() : setWipeArmed(true))}
        >
          <Icon name={wipeArmed ? "alert" : "trash"} size={13} />
          {wipeArmed ? "Tap again to erase everything" : "Clear local data"}
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
