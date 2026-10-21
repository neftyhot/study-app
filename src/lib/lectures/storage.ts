/**
 * Where a lecture's audio lives: a `lectures` folder beside the database,
 * holding one compressed copy per transcript. The desktop app's main process
 * writes them (electron/lectures.cjs); this side only plays and deletes them.
 */
import { dirname, join } from "node:path";

import { resolveDbPath } from "@/db/client";
import { resolveUnder } from "@/lib/ingest/safe-path";

export function lecturesRoot() {
  return join(/* turbopackIgnore: true */ dirname(resolveDbPath()), "lectures");
}

/** The file for a stored `audio_path`, or UnsafePathError if it leaves the folder. */
export function lectureAudioPath(audioPath: string) {
  return resolveUnder(/* turbopackIgnore: true */ lecturesRoot(), audioPath);
}
