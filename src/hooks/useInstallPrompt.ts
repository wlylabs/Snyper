"use client";

import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform = "ios" | "android" | "desktop";

const DISMISS_KEY = "snyper.install.dismissed.v1";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function detectPlatform(): InstallPlatform {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac, so touch points disambiguate it.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/i.test(ua) || iPadOS) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

/**
 * Wraps the platform install flow. Chromium hands us a deferred prompt; iOS has
 * no such event, so the UI falls back to the documented Add to Home Screen path.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<InstallPlatform>("desktop");
  const [dismissed, setDismissed] = useState(true);

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
    setPlatform(detectPlatform());
    setDismissed(readDismissed());

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

  /** Hides the banner for good; the header button stays available. */
  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode: the banner simply returns next session */
    }
  }, []);

  const ios = platform === "ios";
  return {
    /** A native prompt is held and ready to fire. */
    canInstall: Boolean(deferred),
    /** Anything worth offering an install surface for, prompt or manual path. */
    canOffer: Boolean(deferred) || ios,
    install,
    dismiss,
    dismissed,
    standalone,
    platform,
    ios,
  };
}
