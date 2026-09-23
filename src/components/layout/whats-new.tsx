"use client";

/**
 * "Updated to vX" — once per version, dismissed for good.
 *
 * Kept in the browser's storage rather than the database: it is only about
 * this window having shown it, and losing it just shows the notes again.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const SEEN_KEY = "study-app:seen-version";

export function WhatsNew({ version, notes }: { version: string; notes: string[] }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      // Read after mount so the server render never includes it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(SEEN_KEY) !== version) setShow(true);
    } catch {
      // No storage: skip it rather than show it every time.
    }
  }, [version]);

  function dismiss() {
    setShow(false);
    try {
      window.localStorage.setItem(SEEN_KEY, version);
    } catch {
      // Shown again next time; harmless.
    }
  }

  if (!show) return null;

  return (
    <div className="mx-auto mt-4 w-full max-w-(--content-width) px-4">
      <div className="border-primary/30 bg-card rounded-lg border p-3 text-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="text-primary size-4 shrink-0" />
          <p className="flex-1">
            <strong>Updated to v{version}.</strong>{" "}
            <button
              type="button"
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Hide what's new" : "See what's new"}
            </button>
          </p>
          <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={dismiss}>
            <X />
          </Button>
        </div>
        {open ? (
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-10">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li className="list-none pt-1">
              <Link href="/settings#whats-new" className="text-primary hover:underline" onClick={dismiss}>
                All update notes
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}
