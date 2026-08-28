"use client";

import { useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_STORAGE_KEY = "pwa-install-banner-dismissed-at";
const DISMISS_DAYS = 14;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Module-level so the deferred prompt event (and dismissal) is shared across
// any remounts of the banner, and so both stores below can notify listeners
// from outside a React render (an event handler, not an effect body).
let deferredInstallEvent: InstallPromptEvent | null = null;
const visibilityListeners = new Set<() => void>();
const installEventListeners = new Set<() => void>();

function isStandaloneDisplay() {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isRecentlyDismissed() {
  const dismissedAt = Number(window.localStorage.getItem(DISMISS_STORAGE_KEY) ?? "0");
  const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
  return dismissedAt > 0 && daysSinceDismiss < DISMISS_DAYS;
}

function dismissInstallBanner() {
  window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
  visibilityListeners.forEach((listener) => listener());
}

function subscribeToVisibility(callback: () => void) {
  const onAppInstalled = () => callback();
  window.addEventListener("appinstalled", onAppInstalled);
  visibilityListeners.add(callback);
  return () => {
    window.removeEventListener("appinstalled", onAppInstalled);
    visibilityListeners.delete(callback);
  };
}

function getVisibilitySnapshot() {
  return !isStandaloneDisplay() && !isRecentlyDismissed();
}

/** Whether the mobile install nudge should show: not already installed, not recently dismissed. */
function useShouldShowInstallBanner() {
  return useSyncExternalStore(subscribeToVisibility, getVisibilitySnapshot, () => false);
}

function subscribeToInstallEvent(callback: () => void) {
  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredInstallEvent = event as InstallPromptEvent;
    callback();
  };
  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  installEventListeners.add(callback);
  return () => {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    installEventListeners.delete(callback);
  };
}

/** Chrome/Android's deferred native install prompt, captured so we can trigger it from our own button. */
function useInstallPromptEvent() {
  return useSyncExternalStore(subscribeToInstallEvent, () => deferredInstallEvent, () => null);
}

/**
 * Mobile-only nudge to install the PWA. Chrome/Android exposes
 * `beforeinstallprompt`, which we defer and trigger from our own button; iOS
 * Safari has no install API, so we just show the manual "Share > Add to Home
 * Screen" steps instead.
 */
export function InstallPwaBanner() {
  const t = useTranslations("app.install-banner");
  const visible = useShouldShowInstallBanner();
  const installEvent = useInstallPromptEvent();
  const [showSteps, setShowSteps] = useState(false);

  if (!visible) return null;

  async function handleAction() {
    if (!installEvent) {
      setShowSteps((prev) => !prev);
      return;
    }
    await installEvent.prompt();
    const choice = await installEvent.userChoice;
    deferredInstallEvent = null;
    installEventListeners.forEach((listener) => listener());
    if (choice.outcome === "accepted") dismissInstallBanner();
  }

  return (
    <div className="border-b border-topbar-foreground/10 bg-topbar px-3 py-2.5 text-topbar-foreground sm:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{t("title")}</p>
          <p className={cn("mt-0.5 text-xs text-topbar-foreground/70", !showSteps && "truncate")}>
            {showSteps ? (isIosDevice() ? t("ios-steps") : t("android-steps")) : t("body")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="app-sm" onClick={() => void handleAction()}>
            {installEvent ? t("install") : t("how-to")}
          </Button>
          <button
            type="button"
            aria-label={t("dismiss")}
            onClick={dismissInstallBanner}
            className="inline-flex size-8 items-center justify-center rounded-lg text-topbar-foreground/70 transition-colors hover:bg-white/10 hover:text-topbar-foreground"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
