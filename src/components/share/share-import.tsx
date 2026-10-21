"use client";

/**
 * Opening a `.meganstudy` file: picked by hand from the home page, or handed
 * over by the operating system when the student double-clicks one.
 *
 * Both send the file's text to the same route, which checks it and adds it as
 * a new deck; the student lands on that deck.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileInput, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/notify";

type Imported = { examId: string; cardCount: number };

async function importText(text: string): Promise<Imported> {
  const response = await fetch("/api/share/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  const body = (await response.json().catch(() => null)) as (Imported & { error?: string }) | null;
  if (!response.ok || !body?.examId) throw new Error(body?.error ?? "That deck couldn't be opened.");
  return body;
}

function useOpenShared() {
  const router = useRouter();
  return async (name: string, text: string) => {
    try {
      const { examId, cardCount } = await importText(text);
      toast.success(`Added ${name.replace(/\.meganstudy$/i, "")}: ${cardCount} card${cardCount === 1 ? "" : "s"}`);
      router.push(`/exams/${examId}`);
      router.refresh();
    } catch (error) {
      toast.error(`${name}: ${error instanceof Error ? error.message : "couldn't be opened."}`);
    }
  };
}

/** "Open a shared deck" — a file picker for `.meganstudy` files. */
export function OpenSharedDeckButton() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const open = useOpenShared();

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".meganstudy,application/vnd.meganstudy+json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await open(file.name, await file.text());
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <FileInput className="size-4" />}
        Open a shared deck
      </Button>
    </>
  );
}

/** Picks up files the desktop app was opened with. Mounted once in the layout. */
export function ShareFileListener() {
  const open = useOpenShared();
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });

  useEffect(() => {
    const bridge = window.studyApp?.shareFiles;
    if (!bridge) return;
    let cancelled = false;
    const drain = async () => {
      const files = await bridge.take();
      for (const file of files) {
        if (cancelled) return;
        if ("error" in file) toast.error(`${file.name}: ${file.error}`);
        else await openRef.current(file.name, file.text);
      }
    };
    void drain();
    const stop = bridge.onAvailable(() => void drain());
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return null;
}
