"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Wraps the platform install flow, including the iOS manual path. */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setStandalone(true);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const media = window.matchMedia("(display-mode: standalone)");
    const navigatorStandalone = (window.navigator as unknown as { standalone?: boolean })
      .standalone;
    setStandalone(media.matches || navigatorStandalone === true);
    setIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));

    const onDisplayChange = (event: MediaQueryListEvent) => setStandalone(event.matches);
    media.addEventListener("change", onDisplayChange);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", onDisplayChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") setDeferred(null);
    return choice.outcome;
  }, [deferred]);

  return { canInstall: Boolean(deferred), install, standalone, ios };
}
