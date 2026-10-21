"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BookOpen, Check, Cloud, FilePlus2, HardDrive, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  ExperimentalLocalSection,
  ResourceWarning,
} from "@/components/settings/experimental-local";
import { confirmGeminiKey, GeminiKeySteps } from "@/components/settings/gemini-key-steps";
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
import { SOURCE_LABELS, SOURCES, type Source } from "@/lib/sources";
import type { LocalModel } from "@/lib/llm/catalog";
import { openSampleDeck } from "@/lib/sample/actions";
import { PROVIDER_LABELS, type DownloadState } from "@/lib/settings-shared";
import {
  chooseProvider,
  finishSetup,
  saveApiKey,
  saveSourceAction,
  type SetupSnapshot,
} from "@/lib/settings-actions";

const API_PROVIDERS = ["gemini", "anthropic", "openai"] as const;

const KEY_HELP: Record<(typeof API_PROVIDERS)[number], string> = {
  gemini: "aistudio.google.com/apikey",
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com/api-keys",
};

type Step = "start" | "choose" | "local" | "api" | "done";

/**
 * First-run setup.
 *
 * Studying comes first: the student picks the sample deck or their own, and
 * nothing about AI is asked until a feature needs it. A student who already
 * has a key can still set it up here — Gemini on their own Google account up
 * front, a model on this machine as an experimental option behind a warning,
 * and nothing downloaded unless they ask for it.
 */
export function SetupWizard({
  snapshot,
  models,
  source = null,
}: {
  snapshot: SetupSnapshot;
  models: LocalModel[];
  /** Where they heard about the app, if the download link said so. */
  source?: Source | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("start");
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

  async function trySample() {
    setBusy(true);
    try {
      const { examId } = await openSampleDeck();
      router.push(`/exams/${examId}`);
      router.refresh();
    } catch {
      toast.error("Couldn't open the sample deck. Try again, or make your own.");
      setBusy(false);
    }
  }

  if (step === "start") {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">How do you want to start?</h1>
          <p className="text-muted-foreground text-sm">
            No account and no setup. You can study right away.
          </p>
        </div>
        <div className="space-y-3">
          <Choice
            icon={<BookOpen className="size-5" />}
            title="Try the sample deck"
            body="About forty cards on how memory works, with a study guide. Flashcards, Learn, practice exams — all of it, with nothing to set up."
            footnote="Yours to keep or delete."
            onClick={() => void trySample()}
            disabled={busy}
            recommended
          />
          <Choice
            icon={<FilePlus2 className="size-5" />}
            title="Make my own deck"
            body="Upload your notes or slides and get cards from them, or write your own."
            footnote="Making cards from files uses a free Google key — we'll walk you through it when you get there."
            onClick={() => void complete()}
            disabled={busy}
          />
        </div>
        <SourceChips initial={source} />
        <p className="text-muted-foreground text-center text-xs">
          Already have a key?{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => setStep("choose")}
            disabled={busy}
          >
            Set up AI now
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set up AI
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
            body="Paste a free Google AI Studio key — it takes about a minute to make one, and we'll show you how. Or connect Claude or OpenAI with a key. Fast, and strong enough to decompose a broad topic exhaustively."
            footnote="Gemini keys include a free quota on your own Google account; paid keys bill you directly. Studying still works offline."
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
          <Button variant="ghost" size="sm" onClick={() => setStep("start")}>
            Back
          </Button>
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

/** "How did you hear about us?" — optional, one tap, from a fixed list. */
function SourceChips({ initial }: { initial: Source | null }) {
  const [picked, setPicked] = useState<Source | null>(initial);
  return (
    <div className="space-y-2">
      <p id="source-label" className="text-muted-foreground text-xs">
        How did you hear about Megan Study? <span className="opacity-70">(optional)</span>
      </p>
      <div role="group" aria-labelledby="source-label" className="flex flex-wrap gap-2">
        {SOURCES.map((source) => (
          <Button
            key={source}
            size="sm"
            variant={picked === source ? "default" : "outline"}
            aria-pressed={picked === source}
            disabled={picked !== null && picked !== source}
            onClick={() => {
              if (picked) return;
              setPicked(source);
              void saveSourceAction(source);
            }}
          >
            {SOURCE_LABELS[source]}
          </Button>
        ))}
      </div>
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
  disabled = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  footnote: string;
  onClick: () => void;
  recommended?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`hover:bg-muted/60 focus-visible:ring-ring w-full rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60 ${
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
  onBack,
  onSaved,
}: {
  snapshot: SetupSnapshot;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onBack: () => void;
  onSaved: (snapshot: SetupSnapshot) => void;
}) {
  const [provider, setProvider] =
    useState<(typeof API_PROVIDERS)[number]>("gemini");
  const [key, setKey] = useState("");

  const existing = snapshot.keys.find((item) => item.provider === provider);

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

        {provider === "gemini" && !existing?.present ? <GeminiKeySteps /> : null}

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
              (key.trim().length === 0 && !existing?.present)
            }
            onClick={async () => {
              setBusy(true);
              try {
                if (key.trim()) {
                  if (provider === "gemini" && !(await confirmGeminiKey(key))) return;
                  await saveApiKey(provider, key);
                }
                const next = await chooseProvider(provider);
                toast.success(`Using ${PROVIDER_LABELS[provider]}`);
                onSaved(next);
              } finally {
                setBusy(false);
              }
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
