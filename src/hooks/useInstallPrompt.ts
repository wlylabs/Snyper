"use client";

import { useCallback, useSyncExternalStore } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallPlatform = "ios" | "android" | "desktop";

const DISMISS_KEY = "snyper.install.dismissed.v1";

/** Where the boot script in the document head parks the event it caught. */
const STASH = "__snyperInstallPrompt";

type StashWindow = Window & { [STASH]?: BeforeInstallPromptEvent | null };

type InstallState = {
  /** A live prompt, held and not yet spent. */
  deferred: BeforeInstallPromptEvent | null;
  /** One has been held at some point, which is what makes an offer worth making. */
  offered: boolean;
  standalone: boolean;
  platform: InstallPlatform;
  dismissed: boolean;
};

/**
 * Nothing on offer: what the server renders, and what the client renders while
 * it hydrates, so the banner never flashes in and out.
 */
const IDLE: InstallState = {
  deferred: null,
  offered: false,
  standalone: false,
  platform: "desktop",
  dismissed: true,
};

/*
 * One store for the whole app rather than one per component.
 *
 * `beforeinstallprompt` fires once per page load and hands over an event that
 * can be prompted with exactly once. State per hook instance meant the first
 * component to mount captured it and every later one — the install sheet, which
 * only mounts after the banner it lives in becomes visible — registered its
 * listener after the event had already been and gone. The sheet then had no
 * prompt to fire, so the one button the whole banner exists to show was
 * replaced by a paragraph telling the reader to find the browser menu instead.
 */
let state: InstallState = IDLE;
const listeners = new Set<() => void>();

function set(next: Partial<InstallState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function hold(event: BeforeInstallPromptEvent | null): void {
  (window as StashWindow)[STASH] = event;
  set({ deferred: event, ...(event ? { offered: true } : {}) });
}

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

let started = false;

/** Attaches the listeners once, and picks up whatever fired before hydration. */
function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    hold(event as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => {
    hold(null);
    set({ standalone: true });
  });

  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", (event) => set({ standalone: event.matches }));

  const navigatorStandalone = (window.navigator as unknown as { standalone?: boolean })
    .standalone;

  /*
   * Chromium fires the event on load, which is routinely before React has
   * hydrated and can attach anything. The boot script in the document head
   * catches it from the first byte and parks it here; this is where it is
   * collected.
   */
  const stashed = (window as StashWindow)[STASH] ?? null;

  set({
    deferred: stashed,
    offered: Boolean(stashed),
    standalone: media.matches || navigatorStandalone === true,
    platform: detectPlatform(),
    dismissed: readDismissed(),
  });
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): InstallState => state;
const getServerSnapshot = (): InstallState => IDLE;

/**
 * Wraps the platform install flow. Chromium hands us a deferred prompt; iOS has
 * no such event, so the UI falls back to the documented Add to Home Screen path.
 */
export function useInstallPrompt() {
  const { deferred, offered, standalone, platform, dismissed } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const install = useCallback(async () => {
    const held = state.deferred;
    if (!held) return "unavailable" as const;
    try {
      await held.prompt();
      const choice = await held.userChoice;
      return choice.outcome;
    } catch {
      return "unavailable" as const;
    } finally {
      /*
       * Single use: prompting the same event twice throws, and a fresh one only
       * arrives on a fresh page load. Spent is spent, whichever way it went —
       * but not released until the browser's own dialog has closed, so the
       * button does not vanish out from under the dialog it just opened.
       */
      hold(null);
    }
  }, []);

  /** Hides the banner for good; the header button stays available. */
  const dismiss = useCallback(() => {
    set({ dismissed: true });
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
    /*
     * Worth an install surface. Sticky once a prompt has been held, so spending
     * it on a reader who then cancelled the browser's own dialog collapses the
     * sheet to the manual path rather than yanking the whole banner away
     * mid-tap.
     */
    canOffer: offered || ios,
    install,
    dismiss,
    dismissed,
    standalone,
    platform,
    ios,
  };
}
