"use client";

/**
 * The Gemini key, asked for at the moment a feature needs it — never before.
 *
 * Studying, Learn and practice exams all work without one, so setup no longer
 * asks. The first time a student presses something that calls a model, this
 * opens the same walkthrough setup used to show, and carries on with what
 * they pressed once the key is saved.
 */
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { confirmGeminiKey, GeminiKeySteps } from "@/components/settings/gemini-key-steps";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { chooseProvider, noteKeyPromptShown, saveApiKey } from "@/lib/settings-actions";

export const NEEDS_KEY_LABEL = "Add a free key to use this";

type KeyGate = {
  /** True when a model can answer: a key is saved, or a local model is chosen. */
  ready: boolean;
  /** Runs `then` now if AI is ready, otherwise after the student adds a key. */
  withKey: (then?: () => void) => void;
};

// Outside a provider (tests, isolated stories) everything just runs.
const Context = createContext<KeyGate>({ ready: true, withKey: (then) => then?.() });

export function useKeyGate() {
  return useContext(Context);
}

export function KeyGateProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = useRef<(() => void) | undefined>(undefined);
  const isReady = ready || saved;

  const withKey = useCallback(
    (then?: () => void) => {
      if (isReady) {
        then?.();
        return;
      }
      pending.current = then;
      setOpen(true);
      void noteKeyPromptShown();
    },
    [isReady],
  );

  return (
    <Context.Provider value={{ ready: isReady, withKey }}>
      {children}
      <KeyDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) pending.current = undefined;
        }}
        onSaved={() => {
          setSaved(true);
          setOpen(false);
          const then = pending.current;
          pending.current = undefined;
          router.refresh();
          then?.();
        }}
      />
    </Context.Provider>
  );
}

function KeyDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!key.trim()) return;
    setBusy(true);
    try {
      if (!(await confirmGeminiKey(key))) return;
      await saveApiKey("gemini", key);
      await chooseProvider("gemini");
      setKey("");
      toast.success("Key saved — you're all set.");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            This uses AI — add a free key
          </DialogTitle>
          <DialogDescription>
            Making cards, guides and feedback runs on your own free Google key. Studying
            what you already have never needs one.
          </DialogDescription>
        </DialogHeader>
        <GeminiKeySteps />
        <form
          className="space-y-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Label htmlFor="key-gate-input">Gemini API key</Label>
          <Input
            id="key-gate-input"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="Paste it here (starts with AIza)"
            disabled={busy}
          />
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void save()} disabled={busy || !key.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save and continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The quiet line under an AI button while no key is saved. */
export function NeedsKeyHint({ className = "" }: { className?: string }) {
  const { ready, withKey } = useKeyGate();
  if (ready) return null;
  return (
    <button
      type="button"
      onClick={() => withKey()}
      className={`text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline ${className}`}
    >
      {NEEDS_KEY_LABEL}
    </button>
  );
}
