"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { LectureJob, LecturesSnapshot } from "@/main/auth/ipc";

const noSubscription = () => () => {};

/** A job in one of these is still being worked on. */
export const ACTIVE_JOB: LectureJob["status"][] = ["queued", "converting", "transcribing", "saving"];

/**
 * The desktop app's lecture tools, and their state as it changes.
 *
 * `api` is undefined while the page is still what the server sent, null in a
 * browser, where there is no desktop app behind the page.
 */
export function useLectures() {
  const api = useSyncExternalStore(
    noSubscription,
    () => window.studyApp?.lectures ?? null,
    () => undefined,
  );
  const [snapshot, setSnapshot] = useState<LecturesSnapshot | null>(null);

  useEffect(() => {
    if (!api) return;
    let live = true;
    const receive = (next: LecturesSnapshot) => {
      if (live) setSnapshot(next);
    };
    const stop = api.onChange(receive);
    api.state().then(receive, () => {});
    return () => {
      live = false;
      stop();
    };
  }, [api]);

  return { api, snapshot };
}

/** The downloaded model to use when the student has not picked one. */
export function preferredModel(snapshot: LecturesSnapshot | null, chosenId?: string | null) {
  const ready = snapshot?.models.filter((model) => model.status === "ready") ?? [];
  return (
    ready.find((entry) => entry.id === chosenId) ??
    ready.find((entry) => entry.recommended) ??
    ready[0] ??
    null
  );
}
