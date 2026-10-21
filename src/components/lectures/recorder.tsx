"use client";

/**
 * Recording a lecture inside the app.
 *
 * The microphone can only be opened by the page, so this is where the sound
 * comes from; every few seconds of it is handed to the main process, which
 * owns the file (see electron/lectures.cjs). That split is what makes a
 * recording survive: if the page, the window or the whole computer goes away,
 * everything up to the last few seconds is already on disk, and the main
 * process saves it as a lecture to transcribe later.
 *
 * The provider sits in the root layout rather than on the Lectures page so
 * that a recording carries on while the student reads slides or studies cards
 * in another tab.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { useLectures } from "@/components/lectures/use-lectures";
import { formatTimestamp } from "@/lib/lectures/format";
import type { LecturesApi, LecturesSnapshot, RecordingEndReason } from "@/main/auth/ipc";

/** How often the recorder hands over what it has; a crash loses at most this. */
const CHUNK_MS = 3000;
const METER_MS = 100;
/** Below this the microphone is giving nothing at all, not just a quiet room. */
const SILENCE_LEVEL = 0.0015;
const SILENCE_MS = 8000;
const MIC_KEY = "study-app:lecture-mic";

export type RecorderPhase = "idle" | "starting" | "recording" | "paused" | "stopped" | "saving";

export type Microphone = { id: string; label: string };

type Recorder = {
  api: LecturesApi | null | undefined;
  snapshot: LecturesSnapshot | null;
  phase: RecorderPhase;
  /** Seconds recorded, not counting time paused. */
  elapsed: number;
  /** The microphone has given no sound at all for a while. */
  silent: boolean;
  error: string | null;
  /** True when the error is the system refusing the microphone. */
  blocked: boolean;
  title: string;
  setTitle(title: string): void;
  /** Tells the main process the title, so a recovered recording keeps it. */
  commitTitle(): void;
  microphones: Microphone[];
  microphoneId: string;
  chooseMicrophone(id: string): void;
  refreshMicrophones(): void;
  /** How loud the room is right now, 0 to 1. Read it from a timer, not a render. */
  level(): number;
  start(options: { live: boolean; modelId: string | null }): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<void>;
  finish(action: "transcribe" | "later" | "discard", modelId?: string | null): Promise<void>;
  setLive(live: boolean): void;
};

const RecorderContext = createContext<Recorder | null>(null);

export function useRecorder() {
  const recorder = useContext(RecorderContext);
  if (!recorder) throw new Error("useRecorder needs a RecorderProvider above it.");
  return recorder;
}

/** "Lecture – Oct 6, 10:42 AM", for a recording nobody stopped to name. */
export function defaultRecordingTitle(now = new Date()) {
  const day = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Lecture – ${day}, ${time}`;
}

function openMicrophone(deviceId: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      // These are tuned for a voice a hand's width from the microphone, and
      // cut out a lecturer across the room. Gain control is the one that helps.
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });
}

function microphoneProblem(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      blocked: true,
      text: "Megan Study is not allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone, then try again.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { blocked: false, text: "No microphone was found on this computer." };
  }
  if (name === "NotReadableError") {
    return {
      blocked: false,
      text: "The microphone could not be opened. Another app may be using it.",
    };
  }
  return {
    blocked: false,
    text: `The microphone could not be opened (${error instanceof Error ? error.message : String(error)}).`,
  };
}

export function RecorderProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { api, snapshot } = useLectures();

  const [phase, setPhaseState] = useState<RecorderPhase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [silent, setSilent] = useState(false);
  const [problem, setProblem] = useState<{ text: string; blocked: boolean } | null>(null);
  const [title, setTitle] = useState("");
  const [microphones, setMicrophones] = useState<Microphone[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");

  // What the callbacks below need to see as it is now, not as it was when
  // they were made: a recording outlives many renders.
  const phaseRef = useRef<RecorderPhase>("idle");
  const idRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const levelRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const brokenRef = useRef(false);
  /** Milliseconds recorded before the stretch now running, and when that began. */
  const clockRef = useRef({ before: 0, since: 0 });
  const quietSinceRef = useRef<number | null>(null);
  /** The main process has shown this recording in a snapshot. */
  const seenRef = useRef(false);
  const noticeRef = useRef<string | null>(null);

  const setPhase = useCallback((next: RecorderPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const changeTitle = useCallback((next: string) => {
    titleRef.current = next;
    setTitle(next);
  }, []);

  const refreshMicrophones = useCallback(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(
      (devices) => {
        const inputs = devices.filter(
          (device) => device.kind === "audioinput" && device.deviceId !== "default",
        );
        setMicrophones(
          inputs
            // Without permission yet the list is one nameless entry.
            .filter((device) => device.deviceId && device.label)
            .map((device) => ({ id: device.deviceId, label: device.label })),
        );
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MIC_KEY);
      // Read after mount so the server render never includes it.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setMicrophoneId(saved);
    } catch {
      // No storage: the system's default microphone.
    }
    const devices = navigator.mediaDevices;
    if (!devices?.addEventListener) return;
    refreshMicrophones();
    devices.addEventListener("devicechange", refreshMicrophones);
    return () => devices.removeEventListener("devicechange", refreshMicrophones);
  }, [refreshMicrophones]);

  const chooseMicrophone = useCallback((id: string) => {
    setMicrophoneId(id);
    try {
      if (id) window.localStorage.setItem(MIC_KEY, id);
      else window.localStorage.removeItem(MIC_KEY);
    } catch {
      // Not remembered, which only means choosing again next time.
    }
  }, []);

  const runningMs = useCallback(() => {
    const clock = clockRef.current;
    return clock.before + (clock.since ? Date.now() - clock.since : 0);
  }, []);

  /** Lets go of the microphone and everything listening to it. */
  const release = useCallback(() => {
    if (meterRef.current) clearInterval(meterRef.current);
    meterRef.current = null;
    levelRef.current = 0;
    quietSinceRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    streamRef.current = null;
    void audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    recorderRef.current = null;
    setSilent(false);
  }, []);

  /** Stops listening, and waits until the last of the sound is on disk. */
  const endCapture = useCallback(async () => {
    clockRef.current = { before: runningMs(), since: 0 };

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }
    release();
    await queueRef.current;
  }, [release, runningMs]);

  const reset = useCallback(() => {
    idRef.current = null;
    seenRef.current = false;
    brokenRef.current = false;
    clockRef.current = { before: 0, since: 0 };
    queueRef.current = Promise.resolve();
    setElapsed(0);
    changeTitle("");
    setPhase("idle");
  }, [changeTitle, setPhase]);

  /**
   * Ends a recording nobody asked to end, keeping what there is of it for
   * later. The main process leaves the notice that says what happened.
   */
  const endEarly = useCallback(
    async (reason: RecordingEndReason) => {
      const id = idRef.current;
      if (!api || !id) return;
      if (phaseRef.current === "saving" || phaseRef.current === "idle") return;
      setPhase("saving");
      await endCapture();
      try {
        await api.finishRecording({ id, action: "later", title: titleRef.current, reason });
      } catch {
        // The main process is gone or busy; it recovers the file on its own.
      }
      reset();
      router.refresh();
    },
    [api, endCapture, reset, router, setPhase],
  );

  /** Stops listening after a failure, leaving the student to decide the rest. */
  const halt = useCallback(
    async (message: string) => {
      const id = idRef.current;
      if (!api || !id) return;
      if (phaseRef.current !== "recording" && phaseRef.current !== "paused") return;
      setPhase("stopped");
      setProblem({ text: message, blocked: false });
      toast.error(message);
      await endCapture();
      void api.updateRecording({ id, stopped: true }).catch(() => {});
    },
    [api, endCapture, setPhase],
  );

  const start = useCallback(
    async ({ live, modelId }: { live: boolean; modelId: string | null }) => {
      if (!api || phaseRef.current !== "idle") return;
      setPhase("starting");
      setProblem(null);

      let stream: MediaStream;
      try {
        try {
          stream = await openMicrophone(microphoneId);
        } catch (error) {
          // The microphone chosen last time is not plugged in today.
          if (!microphoneId || !(error instanceof DOMException)) throw error;
          if (error.name !== "OverconstrainedError" && error.name !== "NotFoundError") throw error;
          stream = await openMicrophone("");
        }
      } catch (error) {
        const found = microphoneProblem(error);
        setProblem(found);
        setPhase("idle");
        return;
      }
      // Now that it is allowed, the list has names in it.
      refreshMicrophones();

      const name = titleRef.current.trim() || defaultRecordingTitle();
      changeTitle(name);

      let id: string;
      try {
        const result = await api.startRecording({ title: name, live, modelId: modelId ?? "" });
        if (!result.ok) throw new Error(result.error);
        id = result.id;
      } catch (error) {
        for (const track of stream.getTracks()) track.stop();
        setProblem({
          text: error instanceof Error ? error.message : String(error),
          blocked: false,
        });
        setPhase("idle");
        return;
      }

      idRef.current = id;
      seenRef.current = false;
      brokenRef.current = false;
      streamRef.current = stream;
      queueRef.current = Promise.resolve();

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      // Speech needs very little: this is about 22 MB an hour.
      const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size === 0 || brokenRef.current) return;
        const blob = event.data;
        // One after another: the file is only good with its pieces in order.
        queueRef.current = queueRef.current.then(async () => {
          if (brokenRef.current) return;
          try {
            const result = await api.appendRecording({ id, chunk: await blob.arrayBuffer() });
            if (!result.ok) throw new Error(result.error);
          } catch (error) {
            brokenRef.current = true;
            void halt(error instanceof Error ? error.message : String(error));
          }
        });
      };
      recorder.onerror = () => void halt("The recording stopped unexpectedly.");
      for (const track of stream.getAudioTracks()) {
        // Unplugged, or the lid shut on a Mac that stays awake on a monitor.
        track.onended = () => void endEarly("mic");
      }

      try {
        const audio = new AudioContext();
        audioRef.current = audio;
        void audio.resume().catch(() => {});
        const analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        audio.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);

        meterRef.current = setInterval(() => {
          setElapsed(Math.floor(runningMs() / 1000));
          if (phaseRef.current !== "recording") {
            levelRef.current = 0;
            quietSinceRef.current = null;
            return;
          }
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          const rms = Math.sqrt(sum / samples.length);
          // Speech sits around 0.02–0.2; the square root spreads it over the bar.
          levelRef.current = Math.min(1, Math.sqrt(rms) * 1.6);

          const now = Date.now();
          if (rms >= SILENCE_LEVEL) {
            quietSinceRef.current = null;
            setSilent(false);
          } else {
            quietSinceRef.current ??= now;
            if (now - quietSinceRef.current >= SILENCE_MS) setSilent(true);
          }
        }, METER_MS);
      } catch {
        // No meter, but the recording itself does not depend on it.
        meterRef.current = setInterval(() => setElapsed(Math.floor(runningMs() / 1000)), 500);
      }

      clockRef.current = { before: 0, since: Date.now() };
      setElapsed(0);
      recorder.start(CHUNK_MS);
      setPhase("recording");
    },
    [api, changeTitle, endEarly, halt, microphoneId, refreshMicrophones, runningMs, setPhase],
  );

  const pause = useCallback(() => {
    const id = idRef.current;
    if (!api || !id || phaseRef.current !== "recording") return;
    try {
      recorderRef.current?.pause();
    } catch {
      return;
    }
    clockRef.current = { before: runningMs(), since: 0 };
    setPhase("paused");
    void api.updateRecording({ id, paused: true }).catch(() => {});
  }, [api, runningMs, setPhase]);

  const resume = useCallback(() => {
    const id = idRef.current;
    if (!api || !id || phaseRef.current !== "paused") return;
    try {
      recorderRef.current?.resume();
    } catch {
      return;
    }
    clockRef.current = { before: clockRef.current.before, since: Date.now() };
    setPhase("recording");
    void api.updateRecording({ id, paused: false }).catch(() => {});
  }, [api, setPhase]);

  const stop = useCallback(async () => {
    const id = idRef.current;
    if (!api || !id) return;
    if (phaseRef.current !== "recording" && phaseRef.current !== "paused") return;
    setPhase("stopped");
    await endCapture();
    setElapsed(Math.floor(runningMs() / 1000));
    void api.updateRecording({ id, stopped: true }).catch(() => {});
  }, [api, endCapture, runningMs, setPhase]);

  const finish = useCallback(
    async (action: "transcribe" | "later" | "discard", modelId?: string | null) => {
      const id = idRef.current;
      if (!api || !id || phaseRef.current !== "stopped") return;
      setPhase("saving");
      const name = titleRef.current.trim();
      try {
        const result = await api.finishRecording({
          id,
          action,
          title: name || undefined,
          modelId: modelId ?? undefined,
        });
        if (!result.ok) {
          toast.error(result.error);
        } else if (action === "discard") {
          toast("Recording discarded.");
        } else if (result.transcribing) {
          toast.success("Saved. Transcribing it now — you can keep using the app.");
        } else if (action === "transcribe") {
          toast.success("Saved, but transcribing could not start. Transcribe it from the list below.");
        } else {
          toast.success("Saved. Transcribe it whenever you like.");
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
      setProblem(null);
      reset();
      router.refresh();
    },
    [api, reset, router, setPhase],
  );

  const commitTitle = useCallback(() => {
    const id = idRef.current;
    const name = titleRef.current.trim();
    if (!api || !id || !name) return;
    void api.updateRecording({ id, title: name }).catch(() => {});
  }, [api]);

  const setLive = useCallback(
    (live: boolean) => {
      const id = idRef.current;
      if (!api || !id) return;
      void api.updateRecording({ id, live }).catch(() => {});
    },
    [api],
  );

  // What the main process says about the recording this page is making.
  const mine = snapshot?.recording ?? null;
  const interrupted = mine?.interrupted ?? null;
  const mineId = mine?.id ?? null;
  const known = snapshot !== null;
  useEffect(() => {
    const id = idRef.current;
    if (!id || !known) return;
    if (mineId === id) {
      seenRef.current = true;
      // The computer is going to sleep: hand over the last of it and end.
      if (interrupted) void endEarly("sleep");
      return;
    }
    // The main process ended it on its own (it does after a sleep it was not
    // told about in time) and has saved it; all that is left is to let go.
    if (!seenRef.current) return;
    if (phaseRef.current === "saving" || phaseRef.current === "idle") return;
    void (async () => {
      setPhase("saving");
      await endCapture();
      reset();
      router.refresh();
    })();
  }, [endCapture, endEarly, interrupted, known, mineId, reset, router, setPhase]);

  // A recording that ended without being asked to: say so wherever the
  // student is, once. The Lectures page keeps it up until dismissed.
  const notice = snapshot?.notice ?? null;
  useEffect(() => {
    if (!notice || noticeRef.current === notice.id) return;
    noticeRef.current = notice.id;
    toast.warning(notice.text, { duration: 15_000 });
    router.refresh();
  }, [notice, router]);

  const level = useCallback(() => levelRef.current, []);

  const value = useMemo<Recorder>(
    () => ({
      api,
      snapshot,
      phase,
      elapsed,
      silent,
      error: problem?.text ?? null,
      blocked: problem?.blocked ?? false,
      title,
      setTitle: changeTitle,
      commitTitle,
      microphones,
      microphoneId,
      chooseMicrophone,
      refreshMicrophones,
      level,
      start,
      pause,
      resume,
      stop,
      finish,
      setLive,
    }),
    [
      api,
      snapshot,
      phase,
      elapsed,
      silent,
      problem,
      title,
      changeTitle,
      commitTitle,
      microphones,
      microphoneId,
      chooseMicrophone,
      refreshMicrophones,
      level,
      start,
      pause,
      resume,
      stop,
      finish,
      setLive,
    ],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

/** In the header on every page while a lecture is being recorded. */
export function RecordingIndicator() {
  const { phase, elapsed } = useRecorder();
  if (phase === "idle" || phase === "starting") return null;

  const label =
    phase === "recording"
      ? "Recording"
      : phase === "paused"
        ? "Paused"
        : phase === "stopped"
          ? "Recording stopped"
          : "Saving";

  return (
    <Link
      href="/lectures"
      aria-label={`${label}, ${formatTimestamp(elapsed)}. Open the recorder.`}
      className="hover:bg-muted flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium tabular-nums transition-colors"
    >
      <span
        className={
          phase === "recording"
            ? "bg-destructive size-2 animate-pulse rounded-full"
            : "bg-muted-foreground size-2 rounded-full"
        }
      />
      <span className="hidden sm:inline">{label}</span>
      {formatTimestamp(elapsed)}
    </Link>
  );
}
