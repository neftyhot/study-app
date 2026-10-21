"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  AudioLines,
  Check,
  Download,
  FileAudio,
  Loader2,
  Monitor,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { jobForLecture, transcribeSaved } from "@/components/lectures/pending-transcript";
import { RecordCard } from "@/components/lectures/record-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatDuration } from "@/lib/lectures/format";
import { formatBytes } from "@/lib/llm/catalog";
import { cn } from "@/lib/utils";
import type {
  LectureJob,
  LecturesApi,
  LecturesSnapshot,
  WhisperModelState,
} from "@/main/auth/ipc";

export type LectureListItem = {
  id: string;
  title: string;
  durationSeconds: number | null;
  createdAt: string;
  words: number;
  preview: string;
  deckCount: number;
  /** Recorded in the app and saved to transcribe later. */
  pending: boolean;
};

const noSubscription = () => () => {};

const JOB_LABELS: Record<LectureJob["status"], string> = {
  queued: "Waiting its turn",
  converting: "Preparing the audio",
  transcribing: "Transcribing",
  saving: "Saving",
  done: "Done",
  error: "Failed",
  cancelled: "Cancelled",
};

const ACTIVE: LectureJob["status"][] = ["queued", "converting", "transcribing", "saving"];

/** SQLite's `current_timestamp` is UTC without saying so. */
function formatDate(stamp: string) {
  const date = new Date(`${stamp.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The Lectures tab: the recorder, Whisper models, recordings being
 * transcribed, and the transcripts already made.
 *
 * Everything that touches a recording happens in the desktop app's main
 * process and reaches this page as snapshots over IPC, so the page stays
 * responsive during an hour-long lecture, and a job carries on if the user
 * leaves for another tab and comes back.
 */
export function LectureStudio({ lectures }: { lectures: LectureListItem[] }) {
  const router = useRouter();
  const api = useSyncExternalStore(
    noSubscription,
    () => window.studyApp?.lectures ?? null,
    () => undefined,
  );
  const [snapshot, setSnapshot] = useState<LecturesSnapshot | null>(null);
  const [chosenModel, setChosenModel] = useState<string | null>(null);
  const finished = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;

    const receive = (next: LecturesSnapshot) => {
      if (!live) return;
      setSnapshot(next);

      // A job that has just finished put a row in the database: fetch the list
      // again. Jobs already finished when the page opened are in it already.
      const done = new Set(next.jobs.filter((job) => job.status === "done").map((job) => job.id));
      const before = finished.current;
      finished.current = done;
      if (before && [...done].some((id) => !before.has(id))) router.refresh();
    };

    const stop = api.onChange(receive);
    api.state().then(receive, () => {});
    return () => {
      live = false;
      stop();
    };
  }, [api, router]);

  // Still rendering what the server sent: the desktop bridge is not known yet.
  const checking = api === undefined || (api !== null && snapshot === null);

  const ready = snapshot?.models.filter((model) => model.status === "ready") ?? [];
  const model =
    ready.find((entry) => entry.id === chosenModel) ??
    ready.find((entry) => entry.recommended) ??
    ready[0] ??
    null;

  return (
    <div className="space-y-6">
      {checking ? null : !api ? (
        <DesktopOnly />
      ) : snapshot && !snapshot.available ? (
        <DesktopOnly reason={snapshot.unavailableReason} />
      ) : snapshot ? (
        <>
          <RecordCard model={model} />
          <ModelsCard
            api={api}
            models={snapshot.models}
            selectedId={model?.id ?? null}
            onSelect={setChosenModel}
          />
          <ImportCard api={api} model={model} extensions={snapshot.extensions} />
          {snapshot.jobs.length > 0 ? <JobsCard api={api} jobs={snapshot.jobs} /> : null}
        </>
      ) : null}

      <TranscriptList
        lectures={lectures}
        api={api ?? null}
        snapshot={snapshot}
        model={model}
      />
    </div>
  );
}

function DesktopOnly({ reason }: { reason?: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="size-4" />
          Transcription runs in the desktop app
        </CardTitle>
        <CardDescription>
          {reason ??
            "Recordings are transcribed on this computer by the Megan Study desktop app, without an internet connection. Open the app to add a recording; transcripts you have already made are below."}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

async function run(action: Promise<{ ok: boolean; error?: string }>) {
  try {
    const result = await action;
    if (!result.ok) toast.error(result.error ?? "That did not work.");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

function ModelsCard({
  api,
  models,
  selectedId,
  onSelect,
}: {
  api: LecturesApi;
  models: WhisperModelState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transcription models</CardTitle>
        <CardDescription>
          A model is downloaded once and then works offline. Nothing you record leaves
          this computer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {models.map((model) => (
          <ModelRow
            key={model.id}
            api={api}
            model={model}
            selected={model.id === selectedId}
            onSelect={() => onSelect(model.id)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ModelRow({
  api,
  model,
  selected,
  onSelect,
}: {
  api: LecturesApi;
  model: WhisperModelState;
  selected: boolean;
  onSelect: () => void;
}) {
  const percent = model.bytes > 0 ? Math.min(100, (model.receivedBytes / model.bytes) * 100) : 0;
  const busy = model.status === "downloading" || model.status === "verifying";

  return (
    <div className={cn("rounded-lg border p-3", selected && "border-primary")}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{model.name}</span>
            <span className="text-muted-foreground text-xs">{formatBytes(model.bytes)}</span>
            {model.recommended ? <Badge variant="secondary">Recommended</Badge> : null}
            {selected ? <Badge>In use</Badge> : null}
          </div>
          <p className="text-muted-foreground text-sm">{model.description}</p>
        </div>

        <div className="flex items-center gap-2">
          {model.status === "ready" ? (
            <>
              {selected ? null : (
                <Button variant="outline" size="sm" onClick={onSelect}>
                  <Check className="size-4" />
                  Use
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${model.name}`}
                onClick={() => {
                  if (window.confirm(`Delete ${model.name}? You can download it again later.`)) {
                    void run(api.deleteModel(model.id));
                  }
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : busy ? (
            <Button
              variant="outline"
              size="sm"
              disabled={model.status === "verifying"}
              onClick={() => void run(api.cancelDownload(model.id))}
            >
              <X className="size-4" />
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={() => void run(api.downloadModel(model.id))}>
              <Download className="size-4" />
              {model.receivedBytes > 0 ? "Resume" : "Download"}
            </Button>
          )}
        </div>
      </div>

      {busy ? (
        <div className="mt-3 space-y-1">
          <Progress value={percent} aria-label={`Downloading ${model.name}`} />
          <p className="text-muted-foreground text-xs tabular-nums">
            {model.status === "verifying"
              ? "Checking the download…"
              : `${formatBytes(model.receivedBytes)} of ${formatBytes(model.bytes)} · ${Math.floor(percent)}%`}
          </p>
        </div>
      ) : null}
      {model.status === "error" && model.error ? (
        <p className="text-destructive mt-2 text-sm">{model.error}</p>
      ) : null}
    </div>
  );
}

function ImportCard({
  api,
  model,
  extensions,
}: {
  api: LecturesApi;
  model: WhisperModelState | null;
  extensions: string[];
}) {
  const [over, setOver] = useState(false);

  const transcribe = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      if (!model) {
        toast.error("Download a transcription model first.");
        return;
      }
      try {
        const result = await api.transcribe({ paths, modelId: model.id });
        if (!result.ok) {
          toast.error(result.error ?? "Could not start transcribing.");
          return;
        }
        const rejected = result.rejected ?? [];
        if (rejected.length > 0) {
          toast.error(
            `Skipped ${rejected.length === 1 ? rejected[0] : `${rejected.length} files`}: not a recording this app can read.`,
          );
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [api, model],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a recording</CardTitle>
        <CardDescription>
          {model
            ? `Transcribed on this computer with ${model.name}. You can keep using the app while it works.`
            : "Download a model above, then add a lecture recording."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          onDragOver={(event) => {
            event.preventDefault();
            if (model) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const paths = [...event.dataTransfer.files]
              .map((file) => api.pathForFile(file))
              .filter(Boolean);
            void transcribe(paths);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
            over && "border-primary bg-muted",
            !model && "opacity-60",
          )}
        >
          <Upload className="text-muted-foreground size-6" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Drop lecture recordings here</p>
            <p className="text-muted-foreground text-xs">
              {extensions.map((extension) => `.${extension}`).join("  ")}
            </p>
          </div>
          <Button
            disabled={!model}
            onClick={async () => {
              try {
                await transcribe(await api.pickFiles());
              } catch (error) {
                toast.error(error instanceof Error ? error.message : String(error));
              }
            }}
          >
            <FileAudio className="size-4" />
            Choose recordings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function JobsCard({ api, jobs }: { api: LecturesApi; jobs: LectureJob[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>In progress</CardTitle>
        <CardDescription>Recordings are transcribed one at a time.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {jobs.map((job) => {
          const active = ACTIVE.includes(job.status);
          return (
            <div key={job.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.title}</p>
                  <p
                    className={cn(
                      "text-xs",
                      job.status === "error" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {job.status === "error" && job.error
                      ? job.error
                      : `${JOB_LABELS[job.status]}${
                          job.status === "converting" || job.status === "transcribing"
                            ? ` · ${Math.floor(job.progress)}%`
                            : ""
                        }`}
                  </p>
                </div>
                {job.status === "done" && job.lectureId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/lectures/${job.lectureId}`}>Open transcript</Link>
                  </Button>
                ) : null}
                {active ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void run(api.cancelJob(job.id))}
                  >
                    <X className="size-4" />
                    Cancel
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Dismiss"
                    onClick={() => void run(api.dismissJob(job.id))}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>

              {active ? (
                <div className="flex items-center gap-2">
                  {job.status === "queued" || job.status === "saving" ? (
                    <Loader2 className="text-muted-foreground size-3 animate-spin" />
                  ) : null}
                  <Progress
                    value={job.status === "saving" ? 100 : job.progress}
                    aria-label={`${JOB_LABELS[job.status]} ${job.title}`}
                  />
                </div>
              ) : null}
              {job.status === "transcribing" && job.preview ? (
                <p className="text-muted-foreground line-clamp-2 text-sm italic">{job.preview}</p>
              ) : null}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TranscriptList({
  lectures,
  api,
  snapshot,
  model,
}: {
  lectures: LectureListItem[];
  api: LecturesApi | null;
  snapshot: LecturesSnapshot | null;
  model: WhisperModelState | null;
}) {
  if (lectures.length === 0) {
    return (
      <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center text-sm">
        <AudioLines className="size-6" />
        <p>
          No transcripts yet.
          {api ? " Record a lecture or add a recording and it will appear here." : ""}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Transcripts</h2>
      <ul className="space-y-2">
        {lectures.map((lecture) => {
          const job = lecture.pending ? jobForLecture(snapshot, lecture.id) : null;
          const working = job ? ACTIVE.includes(job.status) : false;
          return (
          <li key={lecture.id} className="flex items-stretch gap-2">
            <Link
              href={`/lectures/${lecture.id}`}
              className="hover:bg-muted/50 block min-w-0 flex-1 space-y-1 rounded-lg border p-3 transition-colors"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{lecture.title}</span>
                {lecture.pending ? (
                  <Badge variant="outline">
                    {working && job
                      ? job.status === "transcribing"
                        ? `Transcribing · ${Math.floor(job.progress)}%`
                        : JOB_LABELS[job.status]
                      : "Not transcribed yet"}
                  </Badge>
                ) : null}
                {lecture.deckCount > 0 ? (
                  <Badge variant="secondary">
                    In {lecture.deckCount} {lecture.deckCount === 1 ? "deck" : "decks"}
                  </Badge>
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">
                {[
                  formatDate(lecture.createdAt),
                  formatDuration(lecture.durationSeconds),
                  lecture.pending
                    ? "Recording saved"
                    : lecture.words > 0
                      ? `${lecture.words.toLocaleString()} words`
                      : "No speech found",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {lecture.preview ? (
                <p className="text-muted-foreground line-clamp-2 text-sm">{lecture.preview}</p>
              ) : null}
            </Link>
            {lecture.pending && api && model && !working ? (
              <Button
                variant="outline"
                size="sm"
                className="self-center"
                onClick={() => void transcribeSaved(api, lecture.id, model.id)}
              >
                Transcribe
              </Button>
            ) : null}
          </li>
          );
        })}
      </ul>
    </section>
  );
}
