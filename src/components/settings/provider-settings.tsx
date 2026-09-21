"use client";

import { useEffect, useState } from "react";
import { Check, Cloud, Download, HardDrive, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ExperimentalLocalSection } from "@/components/settings/experimental-local";
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

export function ProviderSettings({
  snapshot,
  models,
}: {
  snapshot: SetupSnapshot;
  models: LocalModel[];
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Cloud className="size-4" />
            Cloud (Google Gemini)
            <Badge>Recommended</Badge>
          </CardTitle>
          <CardDescription>
            Generating cards and grading typed answers need a model. Sign in
            with Google to use Gemini on your own account at no cost, or use
            an API key. Everything else — studying, reviews, browsing,
            editing — works with no model and no network at all.
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
                    {id === "gemini" && state.google
                      ? `Signed in as ${state.google.email ?? "a Google account"}.`
                      : key?.present
                        ? `Key ending …${key.hint} saved.`
                        : id === "gemini"
                          ? "Free with a Google account, or an API key."
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
                  ? "Not ready yet — sign in with Google below, or add an API key."
                  : "Not ready yet — add an API key below."}
          </p>
        </CardContent>
      </Card>

      {usingLocal ? null : (
        <>
          {state.provider === "gemini" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Google account</CardTitle>
                <CardDescription>
                  Sign in to run Gemini on your own account&apos;s free quota.
                  Used ahead of a saved key while you are signed in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GoogleSignIn snapshot={state} onChange={setState} />
              </CardContent>
            </Card>
          ) : null}
          <ApiKeySection snapshot={state} onChange={setState} />
        </>
      )}

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4" />
          {PROVIDER_LABELS[provider]} key
          {provider === "gemini" ? (
            <Badge variant="outline">optional</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          Get one from <span className="font-mono">{KEY_HELP[provider]}</span>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status?.present ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Check className="size-4" />
            Key ending <code className="font-mono">…{status.hint}</code> in use
            {status.fromEnvironment ? (
              <Badge variant="outline">from the environment</Badge>
            ) : null}
          </p>
        ) : null}

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
            only to {PROVIDER_LABELS[provider]}. It is not encrypted at rest.
          </p>
        </div>

        <Button
          disabled={busy || value.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            await saveApiKey(provider, value);
            onChange({ ...snapshot, answerable: true });
            setValue("");
            setBusy(false);
            toast.success("Key saved on this device");
          }}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          Save key
        </Button>
      </CardContent>
    </Card>
  );
}

export { formatBytes };
