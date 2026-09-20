"use client";

import { useEffect, useState } from "react";
import { Check, Download, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What answers your questions</CardTitle>
          <CardDescription>
            Generating cards and grading typed answers need a model. Everything
            else — studying, reviews, browsing, editing — works with no model
            and no network at all.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select
            value={state.provider}
            disabled={busy}
            onValueChange={async (value) => {
              setBusy(true);
              setState(await chooseProvider(value as ProviderId));
              setBusy(false);
              toast.success(`Now using ${PROVIDER_LABELS[value as ProviderId]}`);
            }}
          >
            <SelectTrigger className="sm:w-80">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["local", ...API_PROVIDERS] as ProviderId[]).map((id) => (
                <SelectItem key={id} value={id}>
                  {PROVIDER_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-muted-foreground text-xs">
            {state.answerable
              ? "Ready to generate and grade."
              : "Not ready yet — finish setting up the option above."}
          </p>
        </CardContent>
      </Card>

      {state.provider === "local" ? (
        <LocalModelSection
          models={models}
          snapshot={state}
          onChange={setState}
        />
      ) : (
        <ApiKeySection snapshot={state} onChange={setState} />
      )}
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Download className="size-4" />
          Offline model
        </CardTitle>
        <CardDescription>
          Runs on this machine. Nothing leaves it, and it works with no
          internet once the download is finished.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {download?.status === "ready" ? (
          <p className="flex items-center gap-2 text-sm">
            <Check className="size-4" />
            {models.find((model) => model.id === download.modelId)?.name ??
              download.modelId}{" "}
            is installed and in use
          </p>
        ) : null}

        <ModelPicker
          models={models}
          snapshot={snapshot}
          download={download}
          onDownloadChange={setDownload}
          onSnapshotChange={onChange}
        />
      </CardContent>
    </Card>
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
