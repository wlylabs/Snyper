"use client";

import { useState } from "react";
import { PositionsPanel } from "@/components/snype/PositionsPanel";
import { SignalQueue } from "@/components/snype/SignalQueue";
import { SnypeCard } from "@/components/snype/SnypeCard";
import { SnypeComposer } from "@/components/snype/SnypeComposer";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";
import type { TKey } from "@/lib/i18n";
import { useAppStore } from "@/store/useAppStore";

/**
 * Strategies the section offers. Snype is the only one for now — the tab bar
 * stays so the next strategy is one entry here plus its own panel below.
 */
type Tab = "snype";

const TABS: { value: Tab; label: TKey }[] = [{ value: "snype", label: "bots.tabSnype" }];

export default function StrategiesPage() {
  const mounted = useMounted();
  const { t } = useI18n();
  const snypes = useAppStore((state) => state.snypes);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const [tab, setTab] = useState<Tab>("snype");
  const [composerOpen, setComposerOpen] = useState(false);

  const live = snypes.filter((snype) => !snype.runtime.completed).length;

  const summary = !mounted
    ? t("common.loadingLocal")
    : t("snype.summary", { total: snypes.length, live });

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7 xl:col-span-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">
              {t("bots.title")}
            </h1>
            <p className="mt-0.5 text-[11px] text-faint">{summary}</p>
          </div>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            data-act="add"
            onClick={() => setComposerOpen(true)}
          >
            <Icon name="plus" size={13} />
            {t("snype.new")}
          </button>
        </div>

        <Segmented
          options={TABS.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
          value={tab}
          onChange={setTab}
          // One tab sizes to its label; a second one splits a proper track.
          className={TABS.length > 1 ? "mb-3 w-full max-w-sm" : "mb-3 w-fit"}
        />

        {tab === "snype" &&
          (mounted && snypes.length === 0 ? (
            <Panel bodyClassName="p-0">
              <Empty
                title={t("snype.emptyTitle")}
                action={
                  <button
                    type="button"
                    className="btn btn-sm mt-1"
                    onClick={() => setComposerOpen(true)}
                  >
                    {t("snype.emptyAction")}
                  </button>
                }
              />
            </Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {mounted && snypes.map((snype) => <SnypeCard key={snype.id} snype={snype} />)}
            </div>
          ))}
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5 xl:col-span-4">
        <Panel label={t("bots.dispatchMode")} bodyClassName="p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="check mt-0.5"
              checked={settings.autoDispatch}
              onChange={(event) => setSettings({ autoDispatch: event.target.checked })}
            />
            <span
              className="block text-[12px] font-semibold"
              title={t("bots.autoHint", { count: live })}
            >
              {t("bots.autoLabel")}
            </span>
          </label>
        </Panel>

        <PositionsPanel />
        <SignalQueue />
      </div>

      <SnypeComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}
