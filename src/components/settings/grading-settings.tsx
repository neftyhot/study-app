"use client";

import { useEffect, useState, useTransition } from "react";
import { Cpu, Cloud, Loader2, Zap } from "lucide-react";

import { openUpgradeGuide, toast } from "@/lib/notify";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  STRICTNESS_LABELS,
  STRICTNESS_LEVELS,
  type Strictness,
} from "@/lib/grade/strictness";
import { formatBytes } from "@/lib/llm/catalog";
import type { GradingMode } from "@/lib/settings-shared";
import {
  beginGraderDownload,
  cancelGraderDownload,
  graderDownloadProgress,
  setGradingMode,
  setGradingStrictness,
  type GradingSnapshot,
} from "@/lib/settings-actions";

export function GradingSettings({
  initial,
  grading,
}: {
  initial: Strictness;
  grading: GradingSnapshot;
}) {
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();

  function choose(next: Strictness) {
    const previous = value;
    setValue(next);
    startTransition(async () => {
      const result = await setGradingStrictness(next);
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Typed-answer grading</CardTitle>
        <CardDescription>
          How hard written answers are marked in Learn and in practice exams.
          A reversed direction or a wrong mechanism is always wrong, whatever
          this is set to.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <GradingLocation snapshot={grading} />
        <div role="radiogroup" aria-label="Strictness" className="grid gap-2 sm:grid-cols-3">
          {STRICTNESS_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={value === level}
              disabled={pending}
              onClick={() => choose(level)}
              className={`rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                value === level ? "border-primary bg-primary/5" : "hover:bg-muted/60"
              }`}
            >
              <span className="block text-sm font-medium">
                {STRICTNESS_LABELS[level].label}
              </span>
              <span className="text-muted-foreground mt-1 block text-xs">
                {STRICTNESS_LABELS[level].blurb}
              </span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const MODES: { id: GradingMode; label: string; blurb: string; Icon: typeof Cpu }[] = [
  {
    id: "local",
    label: "This computer",
    blurb: "About half a second, works offline, no usage limits. The cloud is the backup.",
    Icon: Cpu,
  },
  {
    id: "cloud",
    label: "Cloud",
    blurb: "Uses your AI key. If it takes more than a few seconds, this computer answers instead.",
    Icon: Cloud,
  },
];

/** Where Check Answer runs, and the one-time download that makes "this computer" possible. */
function GradingLocation({ snapshot }: { snapshot: GradingSnapshot }) {
  const [mode, setMode] = useState(snapshot.mode);
  const [download, setDownload] = useState(snapshot.download);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (download?.status !== "downloading") return;
    const timer = setInterval(async () => {
      setDownload(await graderDownloadProgress());
    }, 1500);
    return () => clearInterval(timer);
  }, [download?.status]);

  const ready = download?.status === "ready";

  function choose(next: GradingMode) {
    const previous = mode;
    setMode(next);
    startTransition(async () => {
      const result = await setGradingMode(next);
      if (!result.ok) {
        setMode(previous);
        toast.error(result.error);
      }
    });
  }

  function start() {
    startTransition(async () => {
      const result = await beginGraderDownload();
      if (!result.started) {
        toast.error(result.reason);
        return;
      }
      setDownload(await graderDownloadProgress());
    });
  }

  function cancel() {
    startTransition(async () => {
      await cancelGraderDownload();
      setDownload(null);
    });
  }

  const percent =
    download?.status === "downloading" && download.totalBytes
      ? Math.round((download.downloadedBytes / download.totalBytes) * 100)
      : 0;

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Where answers are checked</p>
      <div role="radiogroup" aria-label="Where answers are checked" className="grid gap-2 sm:grid-cols-2">
        {MODES.map(({ id, label, blurb, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={pending || (id === "local" && !snapshot.capable)}
            onClick={() => choose(id)}
            className={`rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50 ${
              mode === id ? "border-primary bg-primary/5" : "hover:bg-muted/60"
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Icon className="size-4" />
              {label}
              {id === "local" ? (
                <span className="text-muted-foreground text-xs font-normal">(recommended)</span>
              ) : null}
            </span>
            <span className="text-muted-foreground mt-1 block text-xs">{blurb}</span>
          </button>
        ))}
      </div>

      {!snapshot.capable ? (
        <p className="text-muted-foreground text-xs">
          This computer has {snapshot.totalRamGb} GB of memory; checking answers here needs 8 GB,
          so answers are checked in the cloud.
        </p>
      ) : ready ? (
        <p className="text-muted-foreground text-xs">
          The checking model is installed.
          {mode === "cloud" ? " It steps in whenever the cloud is slow or offline." : ""}
        </p>
      ) : download?.status === "downloading" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="size-3 animate-spin" />
              Downloading the checking model… {formatBytes(download.downloadedBytes)} of{" "}
              {formatBytes(download.totalBytes)}
            </span>
            <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
          </div>
          <div className="bg-muted h-1.5 overflow-hidden rounded-full">
            <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3">
          <p className="text-muted-foreground text-xs">
            {download?.status === "failed"
              ? "The download stopped. Try again when you're online."
              : `One-time download (${formatBytes(snapshot.modelBytes)}). Until then, answers are checked in the cloud.`}
          </p>
          <Button size="sm" onClick={start} disabled={pending}>
            {download?.status === "failed" ? "Try again" : "Download"}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The optional speed-up. Free AI keys queue behind paying ones, so the tutor,
 * study guides and card generation can take 13–45 seconds. Turning on billing
 * for the same key makes them several times faster. Never required.
 */
export function SpeedUpCard({ provider }: { provider: GradingSnapshot["provider"] }) {
  if (provider === "local") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Zap className="size-4" />
          Speed up
        </CardTitle>
        <CardDescription>
          On a free key, the tutor, study guides and card generation can take 13–45 seconds
          while free requests wait in line. Turning on billing for the same key usually brings
          that down to a few seconds — typically cents per study session. Optional: everything
          works without it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={() => openUpgradeGuide()}>
          <Zap className="size-3.5" />
          Show me how
        </Button>
      </CardContent>
    </Card>
  );
}
