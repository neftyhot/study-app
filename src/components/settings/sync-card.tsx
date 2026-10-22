"use client";

import { useEffect, useState } from "react";
import { Cloud, FolderOpen, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { startSyncAction, stopSyncAction, syncNowAction, type SyncActionResult } from "@/lib/sync/actions";
import type { SyncStatus } from "@/lib/sync/desktop";

function ago(iso: string | null, now: number): string {
  if (!iso) return "not yet";
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString();
}

function folderLabel(folder: string): string {
  const icloud = folder.split("/com~apple~CloudDocs/")[1];
  return icloud ? `iCloud Drive › ${icloud.replace(/\//g, " › ")}` : folder;
}

/**
 * "Sync between devices": decks, cards and progress kept in step through a
 * folder the student already has in the cloud (iCloud Drive, free). Nothing
 * goes through our servers.
 */
export function SyncCard({ initial }: { initial: SyncStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [iCloud, setICloud] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const api = window.studyApp?.sync;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesktop(Boolean(api));
    api?.iCloudAvailable().then(setICloud, () => setICloud(false));
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function show(result: SyncActionResult) {
    setStatus(result.status);
    setNow(Date.now());
    if (!result.ok) setMessage(result.error);
    else if (result.received > 0) setMessage(`Brought in ${result.received} change${result.received === 1 ? "" : "s"}.`);
    else setMessage(result.devices ? "Everything is up to date." : "Synced. Now turn on sync on your iPhone too.");
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const start = (pick: () => Promise<string | null> | undefined) =>
    run(async () => {
      const folder = await pick();
      if (folder) show(await startSyncAction(folder));
    });

  return (
    <Card id="sync" className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="size-4" aria-hidden />
          Sync between devices
        </CardTitle>
        <CardDescription>
          Keep your decks, cards and progress the same on this computer and your iPhone, for
          free, through your own iCloud Drive. Nothing passes through Megan Study&apos;s servers.
          Pictures and uploaded files stay on the device that has them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.folder ? (
          <>
            <p className="text-sm">
              Syncing through <span className="font-medium">{folderLabel(status.folder)}</span>.
              Last synced {ago(status.lastSyncedAt, now)}.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void run(async () => show(await syncNowAction()))} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                Sync now
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setStatus(await stopSyncAction());
                    setMessage("Sync is off. Your decks stay on this computer.");
                  })
                }
              >
                Stop syncing
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              On your iPhone: Settings → Sync between devices → Choose folder, then pick
              &ldquo;{status.folder.split("/").pop()}&rdquo; in iCloud Drive.
            </p>
          </>
        ) : desktop ? (
          <div className="flex flex-wrap gap-2">
            {iCloud ? (
              <Button onClick={() => void start(() => window.studyApp?.sync?.useICloud())} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Cloud className="size-4" aria-hidden />}
                Sync with iCloud Drive
              </Button>
            ) : null}
            <Button
              variant={iCloud ? "outline" : "default"}
              onClick={() => void start(() => window.studyApp?.sync?.pickFolder())}
              disabled={busy}
            >
              <FolderOpen className="size-4" aria-hidden />
              Choose a folder…
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Sync is available in the desktop app.</p>
        )}
        {!status.folder && desktop && !iCloud ? (
          <p className="text-muted-foreground text-xs">
            To use iCloud Drive, turn it on in System Settings → your name → iCloud → iCloud
            Drive. Any synced folder (Dropbox, OneDrive, Google Drive) also works.
          </p>
        ) : null}
        {message ? <p className="text-muted-foreground text-sm" role="status">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
