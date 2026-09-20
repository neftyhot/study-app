"use client";

import { useState } from "react";
import { Check, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearGeminiKey, saveGeminiKey } from "@/lib/settings-actions";
import type { KeyStatus } from "@/lib/settings";

export function ApiKeyForm({ initial }: { initial: KeyStatus }) {
  const [status, setStatus] = useState(initial);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      setStatus(await saveGeminiKey(key));
      setKey("");
      toast.success("Key saved on this device");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          Gemini API key
        </CardTitle>
        <CardDescription>
          Needed only to generate cards and grade typed answers. Studying,
          browsing, and reviews work offline without it.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {status.present ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Check className="size-4" />
            A key ending <code className="font-mono">…{status.hint}</code> is in
            use
            {status.fromEnvironment ? (
              <span className="text-muted-foreground">
                (from the environment, which overrides anything saved here)
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            No key set. Generation and typed grading are unavailable until one
            is added.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="gemini-key">
            {status.present ? "Replace the key" : "Paste your key"}
          </Label>
          <Input
            id="gemini-key"
            type="password"
            value={key}
            autoComplete="off"
            onChange={(event) => setKey(event.target.value)}
            placeholder="AIza…"
            disabled={busy}
          />
          <p className="text-muted-foreground text-xs">
            Stored in this app&apos;s local database on this machine, and never
            sent anywhere except Google&apos;s API. It is not encrypted at rest
            — anyone with access to your user account could read it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || key.trim().length === 0} onClick={() => void save()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save key
          </Button>
          {status.present && !status.fromEnvironment ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setStatus(await clearGeminiKey());
                setBusy(false);
                toast.success("Key removed");
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
