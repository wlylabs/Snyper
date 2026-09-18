"use client";

import { Icon } from "@/components/ui/Icon";
import { useI18n } from "@/hooks/useI18n";
import type { TKey } from "@/lib/i18n";

/**
 * The questions this app used to answer next to the button that raised them.
 *
 * A sentence under a control is read once, by someone who was not asking, every
 * time they pass it. The same sentence here is read by whoever wants it, when
 * they want it, and the controls get to be controls again.
 *
 * What did not move: anything that only appears when something is wrong. A pool
 * that cannot take a trade, a token wearing another's ticker — those are about
 * the thing on screen at that moment, and an answer filed under settings is no
 * answer at all.
 */
const QUESTIONS: readonly { q: TKey; a: TKey }[] = [
  { q: "faq.numbers.q", a: "faq.numbers.a" },
  { q: "faq.total.q", a: "faq.total.a" },
  { q: "faq.small.q", a: "faq.small.a" },
  { q: "faq.marked.q", a: "faq.marked.a" },
  { q: "faq.hide.q", a: "faq.hide.a" },
  { q: "faq.approve.q", a: "faq.approve.a" },
  { q: "faq.slippage.q", a: "faq.slippage.a" },
  { q: "faq.nosell.q", a: "faq.nosell.a" },
  { q: "faq.window.q", a: "faq.window.a" },
];

export function Faq() {
  const { t } = useI18n();

  return (
    <>
      {QUESTIONS.map(({ q, a }) => (
        <details key={q} className="faq">
          <summary>
            <span className="min-w-0 flex-1">{t(q)}</span>
            <Icon name="chevron" size={13} />
          </summary>
          <p className="faq-answer wrap-any">{t(a)}</p>
        </details>
      ))}
    </>
  );
}
