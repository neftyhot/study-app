"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Download, Loader2, Sparkles, Wrench } from "lucide-react";
import { toast } from "@/lib/notify";

import "@/main/auth/ipc";
import { Button } from "@/components/ui/button";
import { appStatusAction, checkForUpdateAction, continueWithoutAiAction } from "@/lib/app-actions";

/**
 * The developer's remote switches, as the student sees them
 * (lib/app-status.ts): a full-screen notice for maintenance or a required
 * update, a banner while AI is off, and a watcher that notices a change.
 */

const POLL_MS = 2 * 60 * 1000;

/** Refreshes the page when the server's status changes what it should show. */
export function StatusWatcher({ signature }: { signature: string }) {
  const router = useRouter();
  const current = useRef(signature);
  useEffect(() => {
    current.current = signature;
  }, [signature]);

  useEffect(() => {
    const check = () =>
      void appStatusAction()
        .then((result) => {
          if (result.signature !== current.current) router.refresh();
        })
        .catch(() => undefined);
    // Soon after opening too: the first answer of the session may be new.
    const first = setTimeout(check, 4000);
    const timer = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [router]);

  return null;
}

export function StatusScreen({
  screen,
  message,
  minVersion,
  until,
}: {
  screen: "maintenance" | "update";
  message: string;
  minVersion: string | null;
  until: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function continueWithoutAi() {
    startTransition(async () => {
      await continueWithoutAiAction(screen);
      router.refresh();
    });
  }

  const maintenance = screen === "maintenance";

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="bg-card space-y-4 rounded-lg border p-6">
        <div className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-full">
          {maintenance ? <Wrench className="size-5" /> : <Download className="size-5" />}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {maintenance ? "Megan Study is under maintenance" : "An update is needed"}
        </h1>
        {message ? <p className="leading-relaxed whitespace-pre-line">{message}</p> : null}
        <p className="text-muted-foreground text-sm leading-relaxed">
          {maintenance
            ? "Making new cards, study guides and everything else that uses AI is switched off for now. Your courses, flashcards, study guides and exams are safe, and you can keep studying them."
            : `This version can't use AI features any more. Update to ${minVersion ?? "the latest version"} or newer to turn them back on. Until then you can keep studying everything you've already made.`}
        </p>
        {maintenance && until ? (
          <p className="text-muted-foreground text-sm">Expected back by {new Date(until).toLocaleString()}.</p>
        ) : null}
        <div className="flex flex-wrap gap-3 pt-2">
          {maintenance ? null : <UpdateNowButton />}
          <Button variant={maintenance ? "default" : "outline"} disabled={pending} onClick={continueWithoutAi}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Continue to studying (no AI)
          </Button>
        </div>
      </div>
      {maintenance ? (
        <p className="text-muted-foreground text-center text-xs">
          This screen goes away by itself when maintenance is over.
        </p>
      ) : null}
    </main>
  );
}

const noSubscription = () => () => undefined;

function UpdateNowButton() {
  const [installing, setInstalling] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  // Known only in the browser; the server render has none, so hydration matches.
  const installer = useSyncExternalStore(noSubscription, () => window.studyApp?.update, () => undefined);

  useEffect(() => {
    void checkForUpdateAction()
      .then((update) => setUrl(update?.url ?? null))
      .catch(() => undefined);
  }, []);

  if (!installer) {
    return (
      <Button asChild>
        <a href={url ?? "https://github.com/neftyhot/study-app/releases/latest"} target="_blank" rel="noreferrer">
          <Download className="size-4" /> Get the update
        </a>
      </Button>
    );
  }

  async function install() {
    if (!installer) return;
    setInstalling(true);
    const id = toast.loading("Downloading the update…");
    const result = await installer.install();
    if (result.ok) {
      toast.success(`Updated to v${result.version} — restarting…`, { id });
    } else {
      toast.error(result.error, { id });
      setInstalling(false);
    }
  }

  return (
    <Button disabled={installing} onClick={() => void install()}>
      {installing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      {installing ? "Updating…" : "Update now"}
    </Button>
  );
}

/** A strip under the header while AI is off, or while the developer has a note for everyone. */
export function StatusBanner({ text, tone }: { text: string; tone: "off" | "note" }) {
  return (
    <div
      role="status"
      className={
        tone === "off"
          ? "border-b border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100"
          : "bg-primary/5 border-b"
      }
    >
      <p className="mx-auto flex w-full max-w-(--content-width) items-start gap-2 px-4 py-2 text-sm">
        {tone === "off" ? <Wrench className="mt-0.5 size-4 shrink-0" /> : <Sparkles className="mt-0.5 size-4 shrink-0" />}
        <span>{text}</span>
      </p>
    </div>
  );
}
