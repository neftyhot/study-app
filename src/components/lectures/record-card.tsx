"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, Mic, Pause, Play, Square, Trash2, X } from "lucide-react";

import { defaultRecordingTitle, useRecorder } from "@/components/lectures/recorder";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTimestamp } from "@/lib/lectures/format";
import { cn } from "@/lib/utils";
import type { WhisperModelState } from "@/main/auth/ipc";

/** Radix has no empty value; this stands for "whatever the system uses". */
const SYSTEM_MIC = "system";

/**
 * Record a lecture with this computer's microphone.
 *
 * The recording itself lives in RecorderProvider, above every page, so this
 * card can come and go as the student moves around the app.
 */
export function RecordCard({ model }: { model: WhisperModelState | null }) {
  const recorder = useRecorder();
  const { api, snapshot, phase } = recorder;
  const [wantLive, setWantLive] = useState(true);
  const [placeholder, setPlaceholder] = useState("Lecture");

  useEffect(() => {
    // The time of day, so not something the server render can know.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaceholder(defaultRecordingTitle());
  }, [phase]);

  const active = phase !== "idle" && phase !== "starting";
  const current = active ? (snapshot?.recording ?? null) : null;
  const live = current ? current.live.enabled : wantLive && Boolean(model);
  const notice = snapshot?.notice ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record a lecture</CardTitle>
        <CardDescription>
          Recorded with this computer&apos;s microphone and kept on this computer. The screen
          stays on while it records. If the lid is closed or the computer goes to sleep, the
          recording ends by itself and is saved to transcribe later.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? (
          <div className="bg-muted flex items-start gap-3 rounded-lg border p-3 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <p className="min-w-0 flex-1">{notice.text}</p>
            {notice.lectureId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/lectures/${notice.lectureId}`}>Open</Link>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Dismiss"
              onClick={() => void api?.dismissNotice().catch(() => {})}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="recording-title">Title</Label>
          <Input
            id="recording-title"
            value={recorder.title}
            placeholder={placeholder}
            maxLength={200}
            disabled={phase === "saving"}
            onChange={(event) => recorder.setTitle(event.target.value)}
            onBlur={recorder.commitTitle}
          />
        </div>

        {!active ? (
          <>
            {recorder.microphones.length > 0 ? (
              <div className="space-y-2">
                <Label htmlFor="recording-mic">Microphone</Label>
                <Select
                  value={
                    recorder.microphones.some((mic) => mic.id === recorder.microphoneId)
                      ? recorder.microphoneId
                      : SYSTEM_MIC
                  }
                  onValueChange={(value) =>
                    recorder.chooseMicrophone(value === SYSTEM_MIC ? "" : value)
                  }
                >
                  <SelectTrigger id="recording-mic" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SYSTEM_MIC}>System default</SelectItem>
                    {recorder.microphones.map((mic) => (
                      <SelectItem key={mic.id} value={mic.id}>
                        {mic.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex items-start gap-2">
              <Checkbox
                id="recording-live"
                checked={wantLive && Boolean(model)}
                disabled={!model}
                onCheckedChange={(checked) => setWantLive(checked === true)}
                className="mt-0.5"
              />
              <div className="space-y-1">
                <Label htmlFor="recording-live">Show the transcript as it records</Label>
                <p className="text-muted-foreground text-xs">
                  {model
                    ? "A rough preview, about fifteen seconds behind. The full transcript is made afterwards and is more accurate."
                    : "Needs a transcription model. You can record without one and transcribe later."}
                </p>
              </div>
            </div>

            {recorder.error ? (
              <div className="space-y-2">
                <p className="text-destructive text-sm">{recorder.error}</p>
                {recorder.blocked ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void api?.openMicSettings().catch(() => {})}
                  >
                    Open microphone settings
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Button
              disabled={phase === "starting"}
              onClick={() => void recorder.start({ live, modelId: model?.id ?? null })}
            >
              {phase === "starting" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mic className="size-4" />
              )}
              Start recording
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-2.5 rounded-full",
                    phase === "recording" ? "bg-destructive animate-pulse" : "bg-muted-foreground",
                  )}
                />
                <span className="text-2xl font-semibold tabular-nums">
                  {formatTimestamp(recorder.elapsed)}
                </span>
                <span className="text-muted-foreground text-sm">
                  {phase === "recording"
                    ? "Recording"
                    : phase === "paused"
                      ? "Paused"
                      : phase === "stopped"
                        ? "Stopped"
                        : "Saving…"}
                </span>
              </div>
              {phase === "recording" || phase === "paused" ? (
                <LevelMeter level={recorder.level} />
              ) : null}
            </div>

            {recorder.silent && phase === "recording" ? (
              <p className="text-destructive flex items-start gap-2 text-sm">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                No sound is coming from this microphone. Check that it is not muted, or stop and
                choose another one. With the lid closed, a laptop&apos;s own microphone is off.
              </p>
            ) : null}
            {recorder.error && phase === "stopped" ? (
              <p className="text-destructive text-sm">
                {recorder.error} What was recorded up to then is safe.
              </p>
            ) : null}

            {phase === "recording" || phase === "paused" ? (
              <div className="flex flex-wrap items-center gap-2">
                {phase === "recording" ? (
                  <Button variant="outline" onClick={recorder.pause}>
                    <Pause className="size-4" />
                    Pause
                  </Button>
                ) : (
                  <Button variant="outline" onClick={recorder.resume}>
                    <Play className="size-4" />
                    Resume
                  </Button>
                )}
                <Button variant="destructive" onClick={() => void recorder.stop()}>
                  <Square className="size-4" />
                  Stop
                </Button>
                {model ? (
                  <label className="text-muted-foreground ml-auto flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={live}
                      onCheckedChange={(checked) => recorder.setLive(checked === true)}
                    />
                    Live transcript
                  </label>
                ) : null}
              </div>
            ) : phase === "stopped" ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    disabled={!model}
                    onClick={() => void recorder.finish("transcribe", model?.id)}
                  >
                    Transcribe now
                  </Button>
                  <Button variant="outline" onClick={() => void recorder.finish("later")}>
                    Save for later
                  </Button>
                  <Button
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => {
                      if (window.confirm("Discard this recording? It cannot be brought back.")) {
                        void recorder.finish("discard");
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    Discard
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {model
                    ? `Transcribing uses ${model.name} and runs in the background. Saving for later keeps the recording in the list below.`
                    : "Download a transcription model below to transcribe. Until then, save it for later."}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" />
                Saving the recording…
              </p>
            )}

            {current && live ? <LivePanel lines={current.live.lines} done={phase !== "recording"} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Moves with the room, so the student can see the microphone is hearing it. */
function LevelMeter({ level }: { level: () => number }) {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Straight to the element: ten renders a second of the whole card is a
    // lot to ask for a bar.
    const timer = setInterval(() => {
      if (bar.current) bar.current.style.width = `${Math.round(level() * 100)}%`;
    }, 100);
    return () => clearInterval(timer);
  }, [level]);

  return (
    <div
      aria-hidden
      className="bg-muted h-2 min-w-32 flex-1 overflow-hidden rounded-full"
    >
      <div ref={bar} className="bg-primary h-full w-0 rounded-full transition-[width] duration-100" />
    </div>
  );
}

function LivePanel({ lines, done }: { lines: { at: number; text: string }[]; done: boolean }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines.length]);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Live transcript</p>
      <div
        ref={box}
        aria-live="off"
        className="bg-muted/50 max-h-64 space-y-1.5 overflow-y-auto rounded-lg border p-3 text-sm"
      >
        {lines.length === 0 ? (
          <p className="text-muted-foreground">
            {done ? "Nothing was heard." : "Listening… the first lines take about fifteen seconds."}
          </p>
        ) : (
          lines.map((line, index) => (
            <p key={`${line.at}-${index}`} className="flex gap-3">
              <span className="text-muted-foreground shrink-0 text-xs leading-5 tabular-nums">
                {formatTimestamp(line.at)}
              </span>
              <span>{line.text}</span>
            </p>
          ))
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        A rough preview. The saved transcript is made from the whole recording and reads better.
      </p>
    </div>
  );
}
