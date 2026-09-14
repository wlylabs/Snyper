"use client";

import { Icon } from "@/components/ui/Icon";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useI18n } from "@/hooks/useI18n";

/** Surfaces the platform install prompt once the browser offers it. */
export function InstallChip() {
  const { canInstall, install, standalone } = useInstallPrompt();
  const { t } = useI18n();
  if (!canInstall || standalone) return null;

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => void install()}
      aria-label={t("settings.installAction")}
      title={t("settings.installAction")}
    >
      <Icon name="download" size={15} />
    </button>
  );
}
