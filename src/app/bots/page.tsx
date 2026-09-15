"use client";

import { useState } from "react";
import { BotCard } from "@/components/bots/BotCard";
import { BotComposer } from "@/components/bots/BotComposer";
import { ContractDesk } from "@/components/bots/ContractDesk";
import { OrderCard } from "@/components/bots/OrderCard";
import { OrderComposer } from "@/components/bots/OrderComposer";
import { PositionsPanel } from "@/components/bots/PositionsPanel";
import { SignalQueue } from "@/components/bots/SignalQueue";
import { SnipeCard } from "@/components/bots/SnipeCard";
import { Icon } from "@/components/ui/Icon";
import { Empty, Panel } from "@/components/ui/Panel";
import { Segmented } from "@/components/ui/Segmented";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";
import { useAppStore } from "@/store/useAppStore";

type Tab = "snipe" | "orders" | "bots";

export default function BotsPage() {
  const mounted = useMounted();
  const { t } = useI18n();
  const bots = useAppStore((state) => state.bots);
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const [tab, setTab] = useState<Tab>("snipe");
  const [composerOpen, setComposerOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);

  const snipes = bots.filter((bot) => bot.strategy.kind === "snipe");
  const orders = bots.filter((bot) => bot.strategy.kind === "order");
  const strategies = bots.filter(
    (bot) => bot.strategy.kind !== "order" && bot.strategy.kind !== "snipe",
  );

  const armed = strategies.filter((bot) => bot.status === "armed").length;
  const autoBots = bots.filter((bot) => bot.execution === "auto").length;
  const liveOrders = orders.filter((order) => !order.runtime.completed).length;
  const liveSnipes = snipes.filter((snipe) => !snipe.runtime.completed).length;

  const summary = !mounted
    ? t("common.loadingLocal")
    : tab === "snipe"
      ? t("bots.snipesSummary", { total: snipes.length, live: liveSnipes })
      : tab === "orders"
        ? t("bots.ordersSummary", { total: orders.length, live: liveOrders })
        : t("bots.summary", { total: strategies.length, armed });

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
          {tab !== "snipe" && (
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => (tab === "orders" ? setOrderOpen(true) : setComposerOpen(true))}
            >
              <Icon name="plus" size={13} />
              {tab === "orders" ? t("order.new") : t("bots.new")}
            </button>
          )}
        </div>

        <Segmented
          options={[
            { value: "snipe" as const, label: t("bots.tabSnipe") },
            { value: "orders" as const, label: t("bots.tabOrders") },
            { value: "bots" as const, label: t("bots.tabBots") },
          ]}
          value={tab}
          onChange={setTab}
          className="mb-3 w-full max-w-sm"
        />

        {tab === "snipe" && (
          <div className="flex flex-col gap-3">
            <ContractDesk />
            {mounted && snipes.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {snipes.map((snipe) => (
                  <SnipeCard key={snipe.id} bot={snipe} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "orders" &&
          (mounted && orders.length === 0 ? (
            <Panel bodyClassName="p-0">
              <Empty
                title={t("order.emptyTitle")}
                hint={t("order.emptyHint")}
                action={
                  <button
                    type="button"
                    className="btn btn-sm mt-1"
                    onClick={() => setOrderOpen(true)}
                  >
                    {t("order.emptyAction")}
                  </button>
                }
              />
            </Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {mounted && orders.map((order) => <OrderCard key={order.id} bot={order} />)}
            </div>
          ))}

        {tab === "bots" &&
          (mounted && strategies.length === 0 ? (
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
              {mounted && strategies.map((bot) => <BotCard key={bot.id} bot={bot} />)}
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
            <span>
              <span className="block text-[12px] font-semibold">{t("bots.autoLabel")}</span>
              <span className="mt-1 block text-[11px] leading-relaxed text-faint">
                {t("bots.autoHint", { count: autoBots })}
              </span>
            </span>
          </label>
        </Panel>

        <PositionsPanel />
        <SignalQueue />
      </div>

      <BotComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
      <OrderComposer open={orderOpen} onClose={() => setOrderOpen(false)} />
    </div>
  );
}
