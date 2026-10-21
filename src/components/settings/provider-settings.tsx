"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronRight, Cloud, Download, HardDrive, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ExperimentalLocalSection } from "@/components/settings/experimental-local";
import { confirmGeminiKey, GeminiKeySteps } from "@/components/settings/gemini-key-steps";
import { ModelPicker } from "@/components/settings/model-picker";
import { ModelLevelCard } from "@/components/settings/upgrade-guide";
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
import {
  chooseProvider,
  downloadProgress,
  saveApiKey,
  type SetupSnapshot,
} from "@/lib/settings-actions";
import { formatBytes, type LocalModel } from "@/lib/llm/catalog";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/settings-shared";

const API_PROVIDERS = ["gemini", "anthropic", "openai"] as const;

const KEY_HELP: Record<(typeof API_PROVIDERS)[number], string> = {
  gemini: "aistudio.google.com/apikey",
  anthropic: "console.anthropic.com",
  openai: "platform.openai.com/api-keys",
};

/**
 * The AI section of Settings: which provider, the key, and whether it works —
 * nothing more on first look. Everything else (other providers, model level,
 * grading, offline models) sits under "Advanced AI settings", closed unless
 * the student is already using an offline model.
 */
export function ProviderSettings({
  snapshot,
  models,
  advanced,
}: {
  snapshot: SetupSnapshot;
  models: LocalModel[];
  /** More cards for the Advanced section, from the page. */
  advanced?: ReactNode;
}) {
  const [state, setState] = useState(snapshot);
  const [busy, setBusy] = useState(false);

  async function choose(id: ProviderId) {
    if (state.provider === id) return;
    setBusy(true);
    setState(await chooseProvider(id));
    setBusy(false);
    toast.success(`Now using ${PROVIDER_LABELS[id]}`);
  }

  const usingLocal = state.provider === "local";
  const downloading = state.download?.status === "downloading";

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {usingLocal ? <HardDrive className="size-4" /> : <Cloud className="size-4" />}
            AI
          </CardTitle>
          <CardDescription>
            Making cards and guides, and feedback on typed answers, use AI.
            Studying what you already have never needs it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Provider</span>
            <span className="font-medium">
              {usingLocal ? "Offline model (experimental)" : PROVIDER_LABELS[state.provider]}
            </span>
            {state.answerable ? (
              <Badge variant="secondary" className="gap-1">
                <Check className="size-3" />
                Working
              </Badge>
            ) : (
              <Badge variant="outline">Not set up yet</Badge>
            )}
          </div>
          {usingLocal ? null : <ApiKeySection snapshot={state} onChange={setState} />}
        </CardContent>
      </Card>

      <details
        open={usingLocal || downloading}
        className="group rounded-lg border"
      >
        <summary className="hover:bg-muted/60 flex cursor-pointer list-none items-center gap-2 rounded-lg p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          Advanced AI settings
          <span className="text-muted-foreground font-normal">
            — other providers, model, grading, offline models
          </span>
        </summary>
        <div className="space-y-6 border-t p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider</CardTitle>
          <CardDescription>
            Google Gemini is recommended and free with your own key. A Claude
            or OpenAI key works too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {API_PROVIDERS.map((id) => {
              const selected = state.provider === id;
              const key = state.keys.find((item) => item.provider === id);

              return (
                <button
                  key={id}
                  type="button"
                  disabled={busy}
                  onClick={() => void choose(id)}
                  className={`rounded-md border p-3 text-left transition-colors ${
                    selected ? "border-primary bg-primary/5" : "hover:bg-muted/60"
                  }`}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {PROVIDER_LABELS[id]}
                    {selected ? <Badge variant="secondary">In use</Badge> : null}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {key?.present
                        ? `Key ending …${key.hint} saved.`
                        : id === "gemini"
                          ? "Needs your free Google AI Studio key."
                          : "Needs an API key (paid)."}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="text-muted-foreground text-xs">
            {usingLocal
              ? "Currently using the experimental offline model. Choose a cloud provider above to switch."
              : state.answerable
                ? "Ready to generate and grade."
                : state.provider === "gemini"
                  ? "Not ready yet — paste your Google AI Studio key below."
                  : "Not ready yet — add an API key below."}
          </p>
        </CardContent>
      </Card>

      {usingLocal ? null : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model</CardTitle>
              <CardDescription>
                Standard suits most courses. Thinking reasons more carefully
                through hard material, and needs billing on your{" "}
                {PROVIDER_LABELS[state.provider]} account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ModelLevelCard snapshot={state} onChange={setState} />
            </CardContent>
          </Card>
        </>
      )}

      {advanced}

      {/*
        Closed unless the student is already on a local model or one is
        downloading — then hiding its controls would only get in the way.
      */}
      <ExperimentalLocalSection
        defaultOpen={
          usingLocal || state.download?.status === "downloading"
        }
      >
        {!usingLocal && state.download?.status === "ready" ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void choose("local")}
          >
            <HardDrive className="size-4" />
            Use the installed offline model
          </Button>
        ) : null}
        <LocalModelSection
          models={models}
          snapshot={state}
          onChange={setState}
        />
      </ExperimentalLocalSection>
        </div>
      </details>
    </div>
  );
}

function LocalModelSection({
  models,
  snapshot,
  onChange,
}: {
  models: LocalModel[];
  snapshot: SetupSnapshot;
  onChange: (snapshot: SetupSnapshot) => void;
}) {
  const [download, setDownload] = useState(snapshot.download);

  // Poll while a download runs: progress lives in one settings row, so this is
  // one cheap read rather than a socket held open across gigabytes.
  useEffect(() => {
    if (download?.status !== "downloading") return;

    const timer = setInterval(async () => {
      setDownload(await downloadProgress());
    }, 1000);

    return () => clearInterval(timer);
  }, [download?.status]);

  // Already inside the experimental section's frame, so no card of its own.
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Download className="size-4" />
          Offline model
        </p>
        <p className="text-muted-foreground text-sm">
          Runs on this machine. Nothing leaves it, and it works with no
          internet once the download is finished.
        </p>
      </div>

      {download?.status === "ready" ? (
        <p className="flex items-center gap-2 text-sm">
          <Check className="size-4" />
          {models.find((model) => model.id === download.modelId)?.name ??
            download.modelId}{" "}
          is installed{snapshot.provider === "local" ? " and in use" : ""}
        </p>
      ) : null}

      <ModelPicker
        models={models}
        snapshot={snapshot}
        download={download}
        onDownloadChange={setDownload}
        onSnapshotChange={onChange}
      />
    </div>
  );
}

function ApiKeySection({
  snapshot,
  onChange,
}: {
  snapshot: SetupSnapshot;
  onChange: (snapshot: SetupSnapshot) => void;
}) {
  const provider = snapshot.provider as (typeof API_PROVIDERS)[number];
  const status = snapshot.keys.find((key) => key.provider === provider);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  // A working key needs no form on screen; replacing it is one click away.
  const [replacing, setReplacing] = useState(false);
  const showForm = !status?.present || replacing;

  return (
    <div className="space-y-3">
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <KeyRound className="mt-0.5 size-4 shrink-0" />
          <span>
            {provider === "gemini"
              ? "Gemini runs on your own free key, so its quota and any billing are on your Google account."
              : <>Get a {PROVIDER_LABELS[provider]} key from <span className="font-mono">{KEY_HELP[provider]}</span>.</>}
          </span>
        </p>
        {provider === "gemini" && !status?.present ? <GeminiKeySteps /> : null}
        {status?.present ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Check className="size-4" />
            Key ending <code className="font-mono">…{status.hint}</code> in use
            {status.fromEnvironment ? (
              <Badge variant="outline">from the environment</Badge>
            ) : null}
          </p>
        ) : status?.needsReentry ? (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            This update stores keys differently, so the key you saved before
            can&apos;t be read any more. Paste it once more below.
          </p>
        ) : null}

        {showForm ? null : (
          <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>
            Replace the key
          </Button>
        )}

        {showForm ? (
        <>
        <div className="space-y-1.5">
          <Label htmlFor={`key-${provider}`}>
            {status?.present ? "Replace the key" : "Paste your key"}
          </Label>
          <Input
            id={`key-${provider}`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={busy}
          />
          <p className="text-muted-foreground text-xs">
            Stored in this app&apos;s local database on this machine, and sent
            only to {PROVIDER_LABELS[provider]}. The desktop app keeps it
            encrypted.
          </p>
        </div>

        <Button
          disabled={busy || value.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              if (provider === "gemini" && !(await confirmGeminiKey(value))) return;
              const saved = await saveApiKey(provider, value);
              onChange({
                ...snapshot,
                answerable: true,
                keys: snapshot.keys.map((item) => (item.provider === provider ? saved : item)),
              });
              setValue("");
              setReplacing(false);
              toast.success("Key saved on this device");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save key
        </Button>
        </>
        ) : null}
    </div>
  );
}

export { formatBytes };
