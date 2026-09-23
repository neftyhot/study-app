"use client";

import { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import "@/main/auth/ipc";
import { Button } from "@/components/ui/button";
import { checkForUpdateAction, type UpdateInfo } from "@/lib/app-actions";

/**
 * A header button when GitHub has a newer release than this build.
 *
 * In the desktop app it installs the update in place and restarts — no DMG
 * to open, and nothing for Gatekeeper to quarantine (electron/updater.cjs).
 * Anywhere else it links to the release.
 */
const CHECK_EVERY_MS = 60 * 60 * 1000;

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);

  // The header never remounts while the app is open — it can run for days —
  // so check again every hour and whenever the window comes back to the front.
  useEffect(() => {
    const check = () => void checkForUpdateAction().then(setUpdate).catch(() => undefined);
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (!update) return null;

  const installer = typeof window === "undefined" ? undefined : window.studyApp?.update;

  if (!installer) {
    return (
      <Button asChild size="sm" variant="secondary" className="gap-1">
        <a href={update.url} target="_blank" rel="noreferrer">
          <Download className="size-3.5" />
          <span className="hidden sm:inline">Update to</span> v{update.version}
        </a>
      </Button>
    );
  }

  async function install() {
    if (!installer) return;
    setInstalling(true);
    const id = toast.loading(`Downloading v${update!.version}…`);
    const result = await installer.install();
    if (result.ok) {
      toast.success(`Updated to v${result.version} — restarting…`, { id });
    } else {
      toast.error(result.error, { id });
      setInstalling(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" className="gap-1" disabled={installing} onClick={() => void install()}>
      {installing ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      <span className="hidden sm:inline">{installing ? "Updating to" : "Update to"}</span> v{update.version}
    </Button>
  );
}
