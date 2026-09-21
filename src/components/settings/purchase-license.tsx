"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { LicenseApi } from "@/main/auth/ipc";

/**
 * Buying the lifetime license during the free trial.
 *
 * Checkout opens in the student's browser; the Electron main process then
 * asks the licensing server for the key minted for this machine, verifies
 * it, and stores it. This only starts that and reports back.
 */
export function PurchaseLicense() {
  const router = useRouter();
  const api = useSyncExternalStore(noSubscription, desktopApi, () => null);
  const [waiting, setWaiting] = useState(false);
  const [checking, setChecking] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stop(), []);

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  async function check(quiet: boolean) {
    if (!api) return;
    setChecking(!quiet);
    try {
      const result = await api.checkPurchase();
      if (!result.found) {
        if (!quiet) {
          toast.message(
            result.configured
              ? "No purchase for this computer yet. It can take a minute after paying."
              : "Paste the key from the confirmation page using the activation screen.",
          );
        }
        return;
      }

      stop();
      setWaiting(false);
      if (result.valid) {
        toast.success("License activated. Thank you!");
        router.refresh();
      } else {
        toast.error(result.message ?? "That license could not be verified.");
      }
    } finally {
      setChecking(false);
    }
  }

  async function purchase() {
    if (!api) return;
    await api.purchase();
    setWaiting(true);

    // Every five seconds for half an hour, as the activation screen does.
    stop();
    const until = Date.now() + 30 * 60 * 1000;
    timer.current = setInterval(() => {
      if (Date.now() > until) {
        stop();
        return;
      }
      void check(true);
    }, 5000);
  }

  if (!api) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      <Button onClick={() => void purchase()}>Purchase License — $24.95</Button>
      {waiting ? (
        <Button variant="outline" disabled={checking} onClick={() => void check(false)}>
          {checking ? <Loader2 className="size-4 animate-spin" /> : null}
          I&apos;ve paid — check now
        </Button>
      ) : null}
      <span className="text-muted-foreground text-xs">
        One-time payment. Unlocks this computer for good.
      </span>
    </div>
  );
}

const noSubscription = () => () => {};

function desktopApi(): LicenseApi | null {
  return window.studyApp?.license ?? null;
}
