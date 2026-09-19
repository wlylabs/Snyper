"use client";

import { useEffect, useState } from "react";

/**
 * The floor below every other screen.
 *
 * `error.tsx` catches a segment and keeps the shell; this catches the shell
 * itself, which means the root layout is gone and with it the stylesheet, the
 * fonts, the providers and the store. Nothing imported for the app is safe to
 * reach for here, so everything below is inline and self-contained — a page
 * that depends on the thing that just failed is not a fallback.
 *
 * It reads the theme and the language straight out of the same stored key the
 * boot script in the layout reads, rather than through the store, because the
 * store's provider is one of the things that is no longer mounted. Both reads
 * are wrapped: at this point localStorage is as likely to be the thing that
 * threw as anything else.
 */
const COPY = {
  en: {
    title: "Something on this screen stopped working.",
    hint: "Nothing was sent and nothing was signed. Your wallet and everything in it are untouched.",
    action: "Reload Snyper",
  },
  id: {
    title: "Ada bagian layar ini yang berhenti bekerja.",
    hint: "Tidak ada yang dikirim dan tidak ada yang ditandatangani. Dompet Anda dan seluruh isinya tidak tersentuh.",
    action: "Muat ulang Snyper",
  },
} as const;

type Stored = { theme: "dark" | "light"; locale: keyof typeof COPY };

function stored(): Stored {
  const fallback: Stored = { theme: "dark", locale: "en" };
  try {
    const raw = window.localStorage.getItem("snyper.state.v2");
    if (!raw) return fallback;
    const settings = JSON.parse(raw)?.state?.settings;
    return {
      theme: settings?.theme === "light" ? "light" : "dark",
      locale: settings?.locale === "id" ? "id" : "en",
    };
  } catch {
    return fallback;
  }
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  /*
   * Server-rendered as the dark default and corrected on mount. A flash of the
   * wrong theme is a small price beside a fallback page that cannot render at
   * all because it read a browser API during prerender.
   */
  const [{ theme, locale }, setStored] = useState<Stored>({ theme: "dark", locale: "en" });
  useEffect(() => setStored(stored()), []);

  useEffect(() => {
    console.error("[snyper] app failed", error);
  }, [error]);

  const dark = theme === "dark";
  const copy = COPY[locale];
  const ink = dark ? "#e9edf3" : "#0f141b";
  const dim = dark ? "#96a1b2" : "#4e5867";
  const faint = dark ? "#616b7b" : "#78828f";

  return (
    <html lang={locale} data-theme={theme}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: dark ? "#07080a" : "#eef1f5",
          color: ink,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
        }}
      >
        <main style={{ display: "grid", gap: 16, maxWidth: 360 }}>
          <span
            style={{
              fontSize: 48,
              lineHeight: 1,
              color: faint,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            !
          </span>
          <p style={{ margin: 0, fontSize: 14, color: dim }}>{copy.title}</p>
          <p style={{ margin: 0, fontSize: 11, color: faint }}>{copy.hint}</p>
          <button
            type="button"
            onClick={reset}
            style={{
              justifySelf: "center",
              padding: "9px 18px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: dark ? "#d7fe4b" : "#c9ee33",
              color: "#0b1000",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {copy.action}
          </button>
          {error.digest && (
            <span
              style={{
                fontSize: 10,
                color: faint,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {error.digest}
            </span>
          )}
        </main>
      </body>
    </html>
  );
}
