"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Logo } from "@/components/ui/Logo";
import { Sheet } from "@/components/ui/Sheet";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useMounted } from "@/hooks/useMounted";
import { useI18n } from "@/hooks/useI18n";

/** Header affordance: opens the install sheet instead of firing the prompt blind. */
export function InstallButton() {
  const mounted = useMounted();
  const { canOffer, standalone } = useInstallPrompt();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!mounted || !canOffer || standalone) return null;

  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen(true)}
        aria-label={t("install.action")}
      >
        <Icon name="download" size={14} />
        <span className="hidden sm:inline">{t("install.short")}</span>
      </button>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/**
 * One-time banner under the status strip. It never returns once dismissed, so
 * the install path stays discoverable without nagging on every visit.
 */
export function InstallBanner() {
  const mounted = useMounted();
  const { canOffer, standalone, dismissed, dismiss } = useInstallPrompt();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!mounted || !canOffer || standalone || dismissed) return null;

  return (
    <div className="mx-auto max-w-[1480px] px-3 pt-3 md:px-4">
      <div className="panel flex items-center gap-3 p-3">
        <Logo size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold">{t("install.bannerTitle")}</p>
          <p className="truncate text-[11px] text-faint">{t("install.bannerHint")}</p>
        </div>
        <button type="button" className="btn btn-accent btn-sm" onClick={() => setOpen(true)}>
          {t("install.short")}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={dismiss}
          aria-label={t("common.close")}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <InstallSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function InstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { canInstall, install, ios, platform, standalone } = useInstallPrompt();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const outcome = await install();
      if (outcome === "accepted") onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title={t("install.title")} onClose={onClose}>
      <div className="p-3">
        <div className="panel ticked flex items-center gap-3 p-4">
          <Logo size={56} className="shrink-0" />
          <div className="min-w-0">
            <p className="brand-word">Snyper</p>
            <p className="mt-2 text-[11px] leading-relaxed text-faint">{t("install.tagline")}</p>
          </div>
        </div>

        <ul className="mt-3 flex flex-col gap-1.5">
          <Benefit text={t("install.benefitLauncher")} />
          <Benefit text={t("install.benefitFullscreen")} />
          <Benefit text={t("install.benefitOffline")} />
          <Benefit text={t("install.benefitKeys")} />
        </ul>

        {standalone ? (
          <p className="mt-4 flex items-center gap-2 text-[12px] long">
            <Icon name="check" size={14} />
            {t("install.installed")}
          </p>
        ) : canInstall ? (
          <button
            type="button"
            className="btn btn-accent btn-block mt-4"
            onClick={() => void run()}
            disabled={busy}
          >
            <Icon name="download" size={14} />
            {busy ? t("install.working") : t("install.action")}
          </button>
        ) : ios ? (
          <div className="mt-4">
            <p className="lbl mb-2">{t("install.iosTitle")}</p>
            <ol className="flex flex-col gap-1.5">
              <Step index={1} text={t("install.iosStep1")} />
              <Step index={2} text={t("install.iosStep2")} />
              <Step index={3} text={t("install.iosStep3")} />
            </ol>
          </div>
        ) : (
          <p className="mt-4 text-[11px] leading-relaxed text-dim">
            {platform === "android" ? t("install.androidHint") : t("install.desktopHint")}
          </p>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-faint">{t("install.note")}</p>
      </div>
    </Sheet>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-[12px] leading-relaxed text-dim">
      <Icon name="check" size={13} className="mt-1 shrink-0 text-accent-text" />
      {text}
    </li>
  );
}

function Step({ index, text }: { index: number; text: string }) {
  return (
    <li className="flex items-start gap-2.5 text-[12px] leading-relaxed text-dim">
      <span className="num flex h-5 w-5 shrink-0 items-center justify-center border border-line text-[10px]">
        {index}
      </span>
      {text}
    </li>
  );
}
