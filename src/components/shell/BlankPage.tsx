"use client";

import { Empty, Panel } from "@/components/ui/Panel";
import { useI18n } from "@/hooks/useI18n";
import type { TKey } from "@/lib/i18n";

type BlankPageProps = {
  title: TKey;
  subtitle: TKey;
  empty: TKey;
  hint: TKey;
};

/**
 * A surface with nothing in it yet.
 *
 * All three screens are in this state, so they share one component rather than
 * three copies of the same placeholder: a heading that says which screen this
 * is, and a panel that says plainly that it is empty instead of filling the
 * space with something nobody asked for. Each page grows its own file the
 * moment it has real content, and this goes when the last one does.
 */
export function BlankPage({ title, subtitle, empty, hint }: BlankPageProps) {
  const { t } = useI18n();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3">
        <h1 className="text-[15px] font-bold tracking-[0.12em] uppercase">{t(title)}</h1>
        <p className="mt-0.5 text-[11px] text-faint">{t(subtitle)}</p>
      </div>
      <Panel>
        <Empty title={t(empty)} hint={t(hint)} />
      </Panel>
    </div>
  );
}
