/**
 * Lectures recorded on the phone, kept in the same `lecture_transcripts`
 * table the desktop's Lectures tab uses. `audio_path` is the recording's file
 * name inside the app's Documents/lectures folder.
 */
import type { TranscriptSegment } from "@megan/core/lectures/format";
import type { SqlDriver } from "@megan/core/platform/types";

import { newId, nowIso } from "./db";

export type Lecture = {
  id: string;
  title: string;
  audioPath: string | null;
  durationSeconds: number | null;
  fullText: string;
  segments: TranscriptSegment[];
  status: "pending" | "done";
  createdAt: string;
};

type Row = {
  id: string;
  title: string;
  audio_path: string | null;
  duration_seconds: number | null;
  full_text: string;
  segments_json: string;
  transcript_status: "pending" | "done";
  created_at: string;
};

function parseSegments(json: string): TranscriptSegment[] {
  try {
    const value = JSON.parse(json) as unknown;
    return Array.isArray(value) ? (value as TranscriptSegment[]) : [];
  } catch {
    return [];
  }
}

const toLecture = (row: Row): Lecture => ({
  id: row.id,
  title: row.title,
  audioPath: row.audio_path,
  durationSeconds: row.duration_seconds,
  fullText: row.full_text,
  segments: parseSegments(row.segments_json),
  status: row.transcript_status,
  createdAt: row.created_at,
});

const COLUMNS = "id, title, audio_path, duration_seconds, full_text, segments_json, transcript_status, created_at";

export async function listLectures(db: SqlDriver): Promise<Lecture[]> {
  const rows = await db.all<Row>(`SELECT ${COLUMNS} FROM lecture_transcripts ORDER BY created_at DESC`);
  return rows.map(toLecture);
}

export async function getLecture(db: SqlDriver, id: string): Promise<Lecture | null> {
  const [row] = await db.all<Row>(`SELECT ${COLUMNS} FROM lecture_transcripts WHERE id = ?`, [id]);
  return row ? toLecture(row) : null;
}

/** `Lecture · Oct 22`, the name a fresh recording gets until it's renamed. */
export function defaultLectureTitle(date = new Date()): string {
  return `Lecture · ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Saves a finished recording, waiting to be transcribed. Returns its id. */
export async function createLecture(
  db: SqlDriver,
  recording: { title: string; audioPath: string; durationSeconds: number },
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.run(
    `INSERT INTO lecture_transcripts (id, title, audio_path, duration_seconds, full_text, segments_json, transcript_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', '[]', 'pending', ?, ?)`,
    [id, recording.title.trim() || defaultLectureTitle(), recording.audioPath, recording.durationSeconds, now, now],
  );
  return id;
}

/** Stores the transcript and marks the lecture done. */
export async function saveTranscript(db: SqlDriver, id: string, segments: TranscriptSegment[]): Promise<void> {
  const clean = segments
    .map((segment) => ({ start: segment.start, end: segment.end, text: segment.text.trim() }))
    .filter((segment) => segment.text)
    .map((segment, index) => ({ id: index, ...segment }));
  const fullText = clean.map((segment) => segment.text).join(" ");
  await db.run(
    "UPDATE lecture_transcripts SET segments_json = ?, full_text = ?, transcript_status = 'done', updated_at = ? WHERE id = ?",
    [JSON.stringify(clean), fullText, nowIso(), id],
  );
}

export async function renameLecture(db: SqlDriver, id: string, title: string): Promise<void> {
  const value = title.trim();
  if (!value) return;
  await db.run("UPDATE lecture_transcripts SET title = ?, updated_at = ? WHERE id = ?", [value, nowIso(), id]);
}

/** Removes the row; the caller deletes the audio file. Returns its file name, if any. */
export async function deleteLecture(db: SqlDriver, id: string): Promise<string | null> {
  const lecture = await getLecture(db, id);
  if (!lecture) return null;
  await db.run("DELETE FROM lecture_transcripts WHERE id = ?", [id]);
  return lecture.audioPath;
}
