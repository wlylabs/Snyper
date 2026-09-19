"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * What a screen falls back to when it throws.
 *
 * Without this, a single uncaught render error anywhere under the shell takes
 * the whole app to the framework's own blank production page — no nav, no way
 * back, and nothing said about what happened to the money. That is the worst
 * possible reading of a crash in an app that signs transactions, because from
 * the reader's side a screen that vanishes mid-trade and a trade that went
 * wrong look identical.
 *
 * So the first thing this says is the true thing: rendering is not signing.
 * Anything that reached the chain reached it through a wallet prompt, and a
 * component failing afterwards cannot unmake or invent one.
 *
 * It sits inside the root layout, which is what makes `reset` worth offering —
 * the shell, the providers and the query cache are all still mounted, so
 * retrying re-renders the segment rather than reloading the app.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  /*
   * There is no error reporter in this build. Until there is, the console is
   * the only place a crash is recoverable from, and a reader reading out a
   * digest is more use to whoever is debugging than the stack they cannot see.
   */
  useEffect(() => {
    console.error("[snyper] screen failed", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
      <span className="num text-[48px] leading-none text-faint">!</span>
      <div className="h-px w-12 bg-edge" />
      <p className="text-sm text-dim">{t("error.title")}</p>
      <p className="text-[11px] text-faint">{t("error.hint")}</p>
      <div className="mt-1 flex items-center gap-2">
        <button type="button" className="btn btn-sm btn-accent" onClick={reset}>
          {t("error.retry")}
        </button>
        <Link href="/" className="btn btn-sm">
          {t("error.home")}
        </Link>
      </div>
      {error.digest && (
        <span className="num text-[10px] text-faint">{error.digest}</span>
      )}
    </div>
  );
}
