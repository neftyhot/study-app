/**
 * Lectures on the phone: record a class (it keeps going with the screen
 * locked), transcribe it on the phone, then make cards from the transcript.
 * Recordings sit in the same table as the desktop's Lectures tab.
 */
import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { formatDuration, formatTimestamp, toDeckNotes } from "@megan/core/lectures/format";

import { useApp } from "../context";
import {
  createLecture,
  defaultLectureTitle,
  deleteLecture,
  getLecture,
  listLectures,
  renameLecture,
  saveTranscript,
  type Lecture,
} from "../data/lectures";
import { canRecord, NEEDS_IPHONE, recorder, speechLocale, type RecorderStatus } from "../platform/recorder";
import { Button, Empty, Notice, Screen, plural, useLoad } from "../components/ui";

import { errorText } from "./source";

const KEEP_AWAKE_SETTING = "lectures-keep-awake";

function readKeepAwake(): boolean {
  try {
    return localStorage.getItem(KEEP_AWAKE_SETTING) === "1";
  } catch {
    return false;
  }
}

export function LecturesScreen() {
  const { db, platform, navigate, changed, version } = useApp();
  const { data, error: loadError } = useLoad(() => listLectures(db), [version]);
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keepAwake, setKeepAwake] = useState(readKeepAwake);
  const [saving, setSaving] = useState(false);
  const startedAt = useRef<Date>(new Date());

  // A recording carries on if the student leaves this screen; pick it back up.
  useEffect(() => {
    void recorder.status().then((now) => {
      if (now.recording) setStatus(now);
    });
  }, []);

  useEffect(() => {
    if (!status?.recording) return;
    const timer = window.setInterval(() => {
      void recorder.status().then(setStatus);
    }, 500);
    return () => window.clearInterval(timer);
  }, [status?.recording]);

  useEffect(() => {
    void recorder.setKeepAwake({ on: Boolean(status?.recording && keepAwake) });
  }, [status?.recording, keepAwake]);

  useEffect(() => () => void recorder.setKeepAwake({ on: false }), []);

  function toggleKeepAwake(on: boolean) {
    setKeepAwake(on);
    try {
      localStorage.setItem(KEEP_AWAKE_SETTING, on ? "1" : "0");
    } catch {
      // Only a preference; it just won't be remembered.
    }
  }

  async function start() {
    setError(null);
    try {
      await recorder.start();
      startedAt.current = new Date();
      void platform.haptics.impact("success");
      setStatus(await recorder.status());
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function togglePause() {
    try {
      setStatus(status?.paused ? await recorder.resume() : await recorder.pause());
      void platform.haptics.impact("tap");
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function stop() {
    setSaving(true);
    try {
      const { file, seconds } = await recorder.stop();
      setStatus(null);
      const id = await createLecture(db, {
        title: defaultLectureTitle(startedAt.current),
        audioPath: file,
        durationSeconds: seconds,
      });
      void platform.haptics.impact("success");
      changed();
      navigate({ name: "lecture", id });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  const recording = status?.recording ?? false;

  return (
    <Screen title="Lectures">
      {loadError ? <Notice tone="error">{loadError}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="panel stack recorder">
        {recording && status ? (
          <>
            <div className="recorder-clock" aria-live="off">
              {formatTimestamp(status.seconds)}
            </div>
            <div className="recorder-level" aria-hidden>
              <span style={{ transform: `scaleX(${status.paused ? 0 : Math.max(0.03, status.level)})` }} />
            </div>
            <p className="muted small">
              {status.paused
                ? "Paused."
                : "Recording. You can lock your phone or switch apps — it keeps going until you tap Stop."}
            </p>
            <div className="inline">
              <Button variant="secondary" onClick={() => void togglePause()} disabled={saving}>
                {status.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                {status.paused ? "Resume" : "Pause"}
              </Button>
              <Button onClick={() => void stop()} disabled={saving}>
                <Square aria-hidden />
                {saving ? "Saving…" : "Stop and save"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>Record a class, then turn what was said into notes and flashcards. Transcribing happens on your phone.</p>
            {canRecord() ? (
              <Button onClick={() => void start()}>
                <Mic aria-hidden />
                Start recording
              </Button>
            ) : (
              <Notice tone="info">{NEEDS_IPHONE}</Notice>
            )}
          </>
        )}
        <label className="switch">
          <span>Keep the screen on while recording</span>
          <input type="checkbox" checked={keepAwake} onChange={(e) => toggleKeepAwake(e.target.checked)} />
        </label>
      </div>

      {data && data.length === 0 ? (
        <Empty title="No lectures yet">Your recordings show up here.</Empty>
      ) : null}

      {data && data.length > 0 ? (
        <div className="section">
          <h2 className="section-title">Recordings</h2>
          <div className="list">
            {data.map((lecture) => (
              <button type="button" className="row" key={lecture.id} onClick={() => navigate({ name: "lecture", id: lecture.id })}>
                <Mic aria-hidden />
                <span className="row-main">
                  <span className="row-title">{lecture.title}</span>
                  <span className="row-sub">
                    {[formatDuration(lecture.durationSeconds), lecture.status === "pending" ? "Not transcribed yet" : "Transcribed"]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </Screen>
  );
}

export function LectureScreen({ id }: { id: string }) {
  const { db, platform, navigate, back, changed, version } = useApp();
  const { data: lecture, error: loadError } = useLoad(() => getLecture(db, id), [id, version]);
  const [title, setTitle] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  async function transcribe(target: Lecture) {
    if (!target.audioPath) return;
    setError(null);
    setProgress("Getting ready to transcribe…");
    const listener = await recorder.addListener("transcribeProgress", ({ done, total }) => {
      setProgress(`Transcribing… ${Math.round((done / Math.max(1, total)) * 100)}%`);
    });
    try {
      const { segments } = await recorder.transcribe({ file: target.audioPath, locale: speechLocale() });
      await saveTranscript(db, target.id, segments);
      void platform.haptics.impact("success");
      changed();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      void listener.remove();
      setProgress(null);
    }
  }

  // A fresh recording starts transcribing straight away.
  useEffect(() => {
    if (!lecture || autoStarted.current) return;
    autoStarted.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lecture.status === "pending" && lecture.audioPath && canRecord()) void transcribe(lecture);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lecture]);

  async function saveTitle() {
    if (title === null || !lecture) return;
    await renameLecture(db, lecture.id, title);
    setTitle(null);
    changed();
  }

  async function remove() {
    if (!lecture || !window.confirm(`Delete “${lecture.title}” and its recording?`)) return;
    const file = await deleteLecture(db, lecture.id);
    if (file) await recorder.remove({ file }).catch(() => undefined);
    changed();
    back();
  }

  function makeCards() {
    if (!lecture) return;
    navigate({ name: "make", notes: { title: lecture.title, text: toDeckNotes(lecture.title, lecture.segments, lecture.fullText) } });
  }

  if (loadError) return <Screen title="Lecture"><Notice tone="error">{loadError}</Notice></Screen>;
  if (!lecture) return <Screen title="Lecture">{null}</Screen>;

  const done = lecture.status === "done";

  return (
    <Screen
      title="Lecture"
      actions={
        <button type="button" className="icon-button" aria-label="Delete lecture" onClick={() => void remove()}>
          <Trash2 aria-hidden />
        </button>
      }
    >
      {error ? <Notice tone="error">{error}</Notice> : null}

      <label className="field">
        <span className="field-label">Title</span>
        <input
          className="input"
          value={title ?? lecture.title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveTitle()}
        />
      </label>
      <p className="muted small">
        {[formatDuration(lecture.durationSeconds), done ? plural(lecture.segments.length, "line") : null].filter(Boolean).join(" · ")}
      </p>

      {progress ? (
        <Notice tone="info">{progress} You can leave this screen open; it takes a little while for a long class.</Notice>
      ) : null}

      {!done && !progress ? (
        <div className="panel stack">
          <p>This lecture hasn&apos;t been transcribed yet.</p>
          <Button onClick={() => void transcribe(lecture)} disabled={!lecture.audioPath || !canRecord()}>
            Transcribe now
          </Button>
        </div>
      ) : null}

      {done ? (
        <>
          <div className="inline">
            <Button onClick={makeCards} disabled={!lecture.fullText.trim()}>
              Make cards from this lecture
            </Button>
            <Button
              variant="secondary"
              onClick={() => void navigator.clipboard?.writeText(lecture.fullText).then(() => platform.haptics.impact("success"))}
            >
              Copy text
            </Button>
          </div>
          {lecture.segments.length === 0 ? (
            <Empty title="No speech found">The recording didn&apos;t have any words the phone could make out.</Empty>
          ) : (
            <div className="transcript">
              {lecture.segments.map((segment) => (
                <p key={segment.id}>
                  <span className="transcript-time">{formatTimestamp(segment.start)}</span> {segment.text}
                </p>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Screen>
  );
}
