"use client";

import { Icon } from "@/components/ui/Icon";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

/** Surfaces the platform install prompt once the browser offers it. */
export function InstallChip() {
  const { canInstall, install, standalone } = useInstallPrompt();
  if (!canInstall || standalone) return null;

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => void install()}
      aria-label="Install app"
      title="Install app"
    >
      <Icon name="download" size={15} />
    </button>
  );
}
