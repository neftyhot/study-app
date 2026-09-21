"use client";

import { useState, useSyncExternalStore } from "react";
import { Loader2, LogOut } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getSetupSnapshot, type SetupSnapshot } from "@/lib/settings-actions";
import type { GoogleAuthApi } from "@/main/auth/ipc";

/**
 * "Sign in with Google", for Gemini on the student's own account.
 *
 * The sign-in happens in the Electron main process, which opens the
 * student's browser and keeps the tokens; this only asks it to start, and
 * shows who is connected. In a plain browser (`npm run dev` without
 * Electron) there is no main process to ask, so it says so instead.
 */
export function GoogleSignIn({
  snapshot,
  onChange,
  onSignedIn,
}: {
  snapshot: SetupSnapshot;
  onChange: (snapshot: SetupSnapshot) => void;
  onSignedIn?: (snapshot: SetupSnapshot) => void;
}) {
  // Null on the server and during hydration, so the first client render
  // matches; the preload has put it on `window` before any page script runs.
  const api = useSyncExternalStore(noSubscription, desktopApi, () => null);
  const [busy, setBusy] = useState<"signing-in" | "signing-out" | null>(null);

  const google = snapshot.google;
  const envKey = snapshot.keys.find(
    (key) => key.provider === "gemini" && key.fromEnvironment,
  );

  async function signIn() {
    if (!api) return;
    setBusy("signing-in");
    let result;
    let next;
    try {
      result = await api.signIn();
      next = await getSetupSnapshot();
      onChange(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      setBusy(null);
    }

    if (result.ok) {
      toast.success(
        result.status.connected && result.status.email
          ? `Signed in as ${result.status.email}`
          : "Signed in with Google",
      );
      onSignedIn?.(next);
    } else {
      toast.error(result.error);
    }
  }

  async function signOut() {
    if (!api) return;
    setBusy("signing-out");
    try {
      await api.signOut();
      onChange(await getSetupSnapshot());
      toast.success("Signed out of Google");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  if (google) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
          <p className="flex min-w-0 items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-emerald-500"
            />
            <span className="truncate">
              Connected as{" "}
              <span className="font-medium">
                {google.email ?? "your Google account"}
              </span>
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !api}
            onClick={() => void signOut()}
          >
            {busy === "signing-out" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Sign out
          </Button>
        </div>
        {envKey ? (
          <p className="text-muted-foreground text-xs">
            GEMINI_API_KEY is set in the environment, and is used instead
            while it is.
          </p>
        ) : null}
      </div>
    );
  }

  if (!api) {
    return (
      <p className="text-muted-foreground text-xs">
        Sign in with Google is available in the desktop app.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button
        variant="outline"
        disabled={busy !== null}
        onClick={() => void signIn()}
      >
        {busy === "signing-in" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <GoogleMark />
        )}
        {busy === "signing-in"
          ? "Finish signing in in your browser…"
          : "Sign in with Google"}
      </Button>
      <p className="text-muted-foreground text-xs">
        Uses your own Google account&apos;s Gemini quota — no API key to
        create or paste. Opens your browser; clicking again starts over.
      </p>
    </div>
  );
}

const noSubscription = () => () => {};

function desktopApi(): GoogleAuthApi | null {
  return window.studyApp?.googleAuth ?? null;
}

/** Google's "G", in its own colours, as the sign-in guidelines ask. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
