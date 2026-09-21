"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Cloud, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ExperimentalLocalSection,
  ResourceWarning,
} from "@/components/settings/experimental-local";
import { GoogleSignIn } from "@/components/settings/google-sign-in";
import { ModelPicker } from "@/components/settings/model-picker";
import { Badge } from "@/components/ui/badge";
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
import type { LocalModel } from "@/lib/llm/catalog";
import { PROVIDER_LABELS, type DownloadState } from "@/lib/settings-shared";
import {
  chooseProvider,
  finishSetup,
  saveApiKey,
  type SetupSnapshot,
} from "@/lib/settings-actions";

const API_PROVIDERS = ["gemini", "anthropic", "openai"] as const;

const KEY_HELP: Record<(typeof API_PROVIDERS)[number], string> = {
  gemini: "aistudio.google.com/apikey",
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com/api-keys",
};

type Step = "choose" | "local" | "api" | "done";

/**
 * First-run setup.
 *
 * One decision, asked once, with the answer most students want up front:
 * Gemini on their own Google account, free and fast. Running a model on the
 * machine is still offered, but as an experimental option behind a warning,
 * and nothing is downloaded unless the student asks for it here.
 */
export function SetupWizard({
  snapshot,
  models,
}: {
  snapshot: SetupSnapshot;
  models: LocalModel[];
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [state, setState] = useState(snapshot);
  const [download, setDownload] = useState<DownloadState | null>(
    snapshot.download,
  );
  const [busy, setBusy] = useState(false);

  async function complete() {
    setBusy(true);
    await finishSetup();
    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up Study App
        </h1>
        <p className="text-muted-foreground text-sm">
          One question, then you are done. You can change any of this later.
        </p>
      </div>

      {step === "choose" ? (
        <div className="space-y-3">
          <Choice
            icon={<Cloud className="size-5" />}
            title="Use Google Gemini (recommended)"
            body="Sign in with your Google account to use Gemini at no cost — no key to create or paste. Or connect Claude, Gemini, or OpenAI with an API key. Fast, and strong enough to decompose a broad topic exhaustively."
            footnote="Google sign-in uses your account's free quota; with a key, you pay the provider for what you use. Studying still works offline."
            onClick={() => setStep("api")}
            recommended
          />
          <ExperimentalLocalSection>
            <Choice
              icon={<HardDrive className="size-5" />}
              title="Work entirely offline"
              body="Download a model that runs on this machine. Nothing you upload and nothing you write ever leaves it."
              footnote="Slower and weaker than Gemini on most laptops."
              onClick={() => setStep("local")}
            />
          </ExperimentalLocalSection>
          <p className="text-muted-foreground text-center text-xs">
            Either way, studying, reviews, and editing never need a model or a
            network.
          </p>
        </div>
      ) : null}

      {step === "local" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose a size</CardTitle>
            <CardDescription>
              Bigger models understand more. A very small one can rephrase a
              definition, but it cannot hold a multi-step pathway together —
              on anatomy and physiology it will produce confident, wrong cards.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResourceWarning />
            <ModelPicker
              models={models}
              snapshot={state}
              download={download}
              onDownloadChange={setDownload}
              onSnapshotChange={setState}
            />

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !download}
                onClick={() => void complete()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {download?.status === "ready"
                  ? "Start studying"
                  : "Carry on while it downloads"}
              </Button>
              <Button variant="ghost" onClick={() => setStep("choose")}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "api" ? (
        <ApiStep
          snapshot={state}
          busy={busy}
          onChange={setState}
          onBack={() => setStep("choose")}
          onSaved={(next) => {
            setState(next);
            void complete();
          }}
          setBusy={setBusy}
        />
      ) : null}

      <p className="text-muted-foreground text-center text-xs">
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => void complete()}
        >
          Skip for now
        </button>{" "}
        — you can still upload material and study; generating cards will ask
        again.
      </p>
    </div>
  );
}

function Choice({
  icon,
  title,
  body,
  footnote,
  onClick,
  recommended = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  footnote: string;
  onClick: () => void;
  recommended?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hover:bg-muted/60 focus-visible:ring-ring w-full rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        recommended ? "border-primary bg-primary/5" : ""
      }`}
    >
      <span className="flex items-center gap-2 font-medium">
        {icon}
        {title}
      </span>
      <span className="text-muted-foreground mt-1.5 block text-sm">{body}</span>
      <span className="text-muted-foreground mt-1 block text-xs">
        {footnote}
      </span>
    </button>
  );
}

function ApiStep({
  snapshot,
  busy,
  setBusy,
  onChange,
  onBack,
  onSaved,
}: {
  snapshot: SetupSnapshot;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onChange: (snapshot: SetupSnapshot) => void;
  onBack: () => void;
  onSaved: (snapshot: SetupSnapshot) => void;
}) {
  const [provider, setProvider] =
    useState<(typeof API_PROVIDERS)[number]>("gemini");
  const [key, setKey] = useState("");

  const existing = snapshot.keys.find((item) => item.provider === provider);
  const signedIn = provider === "gemini" && snapshot.google !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Connect a provider</CardTitle>
        <CardDescription>
          The key is stored on this machine only, and sent nowhere except the
          provider you pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {API_PROVIDERS.map((id) => (
            <Button
              key={id}
              size="sm"
              variant={provider === id ? "default" : "outline"}
              onClick={() => setProvider(id)}
            >
              {PROVIDER_LABELS[id]}
              {snapshot.keys.find((item) => item.provider === id)?.present ? (
                <Check className="size-3.5" />
              ) : null}
            </Button>
          ))}
        </div>

        {provider === "gemini" ? (
          <div className="space-y-3">
            <GoogleSignIn
              snapshot={snapshot}
              onChange={onChange}
              onSignedIn={async () => {
                setBusy(true);
                const next = await chooseProvider("gemini");
                setBusy(false);
                onSaved(next);
              }}
            />
            <p className="text-muted-foreground text-xs">
              Or use an API key instead:
            </p>
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="setup-key">API key</Label>
          <Input
            id="setup-key"
            type="password"
            autoComplete="off"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder={existing?.present ? "A key is already saved" : "Paste it here"}
            disabled={busy}
          />
          <p className="text-muted-foreground text-xs">
            From <span className="font-mono">{KEY_HELP[provider]}</span>
            {existing?.present ? (
              <>
                {" "}
                · <Badge variant="outline">…{existing.hint} saved</Badge>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy ||
              (key.trim().length === 0 && !existing?.present && !signedIn)
            }
            onClick={async () => {
              setBusy(true);
              if (key.trim()) await saveApiKey(provider, key);
              const next = await chooseProvider(provider);
              setBusy(false);
              toast.success(`Using ${PROVIDER_LABELS[provider]}`);
              onSaved(next);
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Save and start
          </Button>
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            Back
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
