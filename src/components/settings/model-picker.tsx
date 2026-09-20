"use client";

import { useState } from "react";
import { Cpu, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  formatBytes,
  TIER_LABELS,
  type LocalModel,
} from "@/lib/llm/catalog";
import {
  beginModelDownload,
  cancelDownload,
  type SetupSnapshot,
} from "@/lib/settings-actions";
import type { DownloadState } from "@/lib/settings-shared";

/**
 * Choosing a model, in the student's terms.
 *
 * Every row leads with what the model can actually do for their coursework,
 * not with parameter counts — the download size and memory requirement are
 * there because they are real constraints, but the sentence that decides it is
 * the one about whether it can hold a pathway together.
 */
export function ModelPicker({
  models,
  snapshot,
  download,
  onDownloadChange,
  onSnapshotChange,
}: {
  models: LocalModel[];
  snapshot: SetupSnapshot;
  download: DownloadState | null;
  onDownloadChange: (state: DownloadState | null) => void;
  onSnapshotChange?: (snapshot: SetupSnapshot) => void;
}) {
  const [busy, setBusy] = useState(false);
  const downloading = download?.status === "downloading";

  async function start(model: LocalModel) {
    setBusy(true);
    const result = await beginModelDownload(model.id);
    setBusy(false);

    if (!result.started) {
      toast.error(result.reason);
      return;
    }

    onDownloadChange({
      modelId: model.id,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: model.bytes,
    });
    onSnapshotChange?.({ ...snapshot, provider: "local" });
    toast.success(`Downloading ${model.name} in the background`);
  }

  return (
    <div className="space-y-3">
      {download ? (
        <DownloadStatus
          download={download}
          models={models}
          onClear={async () => {
            await cancelDownload();
            onDownloadChange(null);
          }}
        />
      ) : null}

      <p className="text-muted-foreground text-xs">
        This machine has about {snapshot.totalRamGb} GB of memory. Bigger models
        are slower and need more of it, and a model that does not fit will
        crawl.
      </p>

      <div className="space-y-2">
        {models.map((model) => {
          const fits = model.minimumRamGb <= snapshot.totalRamGb;
          const recommended = model.id === snapshot.recommendedModelId;
          const installed =
            download?.status === "ready" && download.modelId === model.id;

          return (
            <div
              key={model.id}
              className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {model.name}
                  <Badge variant="secondary">{TIER_LABELS[model.tier]}</Badge>
                  {recommended ? <Badge>Recommended</Badge> : null}
                  {installed ? <Badge variant="outline">Installed</Badge> : null}
                </p>

                <p className="text-muted-foreground text-xs">{model.summary}</p>

                {model.caution ? (
                  <p className="text-muted-foreground flex gap-1.5 text-xs">
                    <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                    {model.caution}
                  </p>
                ) : null}

                <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
                  <Cpu className="size-3" />
                  {formatBytes(model.bytes)} download · needs{" "}
                  {model.minimumRamGb} GB memory · {model.license}
                  {!fits ? (
                    <Badge variant="destructive">
                      more memory than this machine has
                    </Badge>
                  ) : null}
                </p>
              </div>

              <Button
                size="sm"
                variant={recommended ? "default" : "outline"}
                disabled={busy || downloading || installed}
                onClick={() => void start(model)}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                {installed ? "Installed" : "Download"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DownloadStatus({
  download,
  models,
  onClear,
}: {
  download: DownloadState;
  models: LocalModel[];
  onClear?: () => void;
}) {
  const model = models.find((item) => item.id === download.modelId);
  const name = model?.name ?? download.modelId;

  if (download.status === "failed") {
    return (
      <div className="space-y-2 rounded-md border p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <TriangleAlert className="size-4" />
          {name} could not be downloaded
        </p>
        <p className="text-muted-foreground text-xs">{download.error}</p>
        {onClear ? (
          <Button size="sm" variant="outline" onClick={onClear}>
            Try a different model
          </Button>
        ) : null}
      </div>
    );
  }

  if (download.status === "ready") return null;

  const percent = download.totalBytes
    ? Math.min(100, (download.downloadedBytes / download.totalBytes) * 100)
    : 0;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-3.5 animate-spin" />
        Downloading {name}
      </p>
      <Progress value={percent} />
      <p className="text-muted-foreground text-xs">
        {formatBytes(download.downloadedBytes)} of{" "}
        {formatBytes(download.totalBytes)} — carry on using the app, this
        continues in the background.
      </p>
    </div>
  );
}
