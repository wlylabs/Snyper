"use client";

import { useState } from "react";
import { BotCard } from "@/components/bots/BotCard";
import { BotComposer } from "@/components/bots/BotComposer";
import { SignalQueue } from "@/components/bots/SignalQueue";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel } from "@/components/ui/Panel";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";
import { useAppStore } from "@/store/useAppStore";

export default function BotsPage() {
  const mounted = useMounted();
  const { t } = useI18n();
  const bots = useAppStore((state) => state.bots);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const [composerOpen, setComposerOpen] = useState(false);

  const armed = bots.filter((bot) => bot.status === "armed").length;
  const autoBots = bots.filter((bot) => bot.execution === "auto").length;

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7 xl:col-span-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">
              {t("bots.title")}
            </h1>
            <p className="mt-0.5 text-[11px] text-faint">
              {mounted
                ? t("bots.summary", { total: bots.length, armed })
                : t("common.loadingLocal")}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-accent btn-sm"
            onClick={() => setComposerOpen(true)}
          >
            <Icon name="plus" size={13} />
            {t("bots.new")}
          </button>
        </div>

        {mounted && bots.length === 0 ? (
          <Panel bodyClassName="p-0">
            <Empty
              title={t("bots.emptyTitle")}
              hint={t("bots.emptyHint")}
              action={
                <button
                  type="button"
                  className="btn btn-sm mt-1"
                  onClick={() => setComposerOpen(true)}
                >
                  {t("bots.emptyAction")}
                </button>
              }
            />
          </Panel>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {mounted && bots.map((bot) => <BotCard key={bot.id} bot={bot} />)}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:col-span-5 xl:col-span-4">
        <Panel label={t("bots.dispatchMode")} bodyClassName="p-3">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
              checked={settings.autoDispatch}
              onChange={(event) => setSettings({ autoDispatch: event.target.checked })}
            />
            <span>
              <span className="block text-[12px] font-semibold">{t("bots.autoLabel")}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-faint">
                {t("bots.autoHint", { count: autoBots })}
              </span>
            </span>
          </label>
        </Panel>

        <SignalQueue />
      </div>

      <BotComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </div>
  );
}
