"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ACTIVE_JOB, preferredModel, useLectures } from "@/components/lectures/use-lectures";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { LecturesApi, LecturesSnapshot } from "@/main/auth/ipc";

/** The job, if any, that is working on (or has just finished) this lecture. */
export function jobForLecture(snapshot: LecturesSnapshot | null, lectureId: string) {
  const jobs = snapshot?.jobs.filter((job) => job.lectureId === lectureId) ?? [];
  return jobs.find((job) => ACTIVE_JOB.includes(job.status)) ?? jobs.at(-1) ?? null;
}

export async function transcribeSaved(api: LecturesApi, lectureId: string, modelId: string) {
  try {
    const result = await api.transcribeLecture({ lectureId, modelId });
    if (!result.ok) toast.error(result.error);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Where the transcript will be, for a lecture recorded in the app and saved
 * to transcribe later.
 */
export function PendingTranscript({ lectureId }: { lectureId: string }) {
  const router = useRouter();
  const { api, snapshot } = useLectures();
  const job = jobForLecture(snapshot, lectureId);
  const model = preferredModel(snapshot);
  const working = job ? ACTIVE_JOB.includes(job.status) : false;
  const finished = job?.status === "done";

  // The transcript is in the database now; fetch the page with it in.
  useEffect(() => {
    if (finished) router.refresh();
  }, [finished, router]);

  if (job && (working || finished)) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          {job.status === "queued"
            ? "Waiting its turn…"
            : job.status === "converting"
              ? "Preparing the audio…"
              : job.status === "transcribing"
                ? `Transcribing · ${Math.floor(job.progress)}%`
                : "Saving…"}
        </p>
        <Progress
          value={job.status === "transcribing" ? job.progress : finished ? 100 : 0}
          aria-label="Transcribing this lecture"
        />
        {job.preview ? (
          <p className="text-muted-foreground line-clamp-2 text-sm italic">{job.preview}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          You can leave this page; it carries on in the background.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        This lecture was recorded and saved without a transcript. You can listen to it above,
        and transcribe it whenever you like.
      </p>
      {job?.status === "error" && job.error ? (
        <p className="text-destructive text-sm">{job.error}</p>
      ) : null}
      {!api ? (
        <p className="text-muted-foreground text-sm">
          Transcribing runs in the Megan Study desktop app.
        </p>
      ) : model ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void transcribeSaved(api, lectureId, model.id)}>
            Transcribe now
          </Button>
          <span className="text-muted-foreground text-xs">
            With {model.name}, on this computer.
          </span>
        </div>
      ) : snapshot ? (
        <Button asChild variant="outline">
          <Link href="/lectures">Download a transcription model first</Link>
        </Button>
      ) : null}
    </div>
  );
}
