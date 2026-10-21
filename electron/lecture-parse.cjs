/**
 * Reading what ffmpeg and whisper-cli print.
 *
 * Kept apart from lectures.cjs, which spawns them, so that none of this needs
 * Electron or a real recording to be tested (src/lib/lectures/parse.test.ts).
 */
const path = require("node:path");

/** Recordings the Lectures tab accepts; ffmpeg reads the audio out of the videos. */
const AUDIO_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "mov", "mp4"];

function isSupportedRecording(file) {
  return AUDIO_EXTENSIONS.includes(path.extname(String(file)).slice(1).toLowerCase());
}

/** `HH:MM:SS.xx` (ffmpeg, whisper's console) or `HH:MM:SS,xxx` (SRT) in seconds. */
function clockToSeconds(clock) {
  const match = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(String(clock).trim());
  if (!match) return null;
  const [, hours, minutes, seconds, fraction] = match;
  return (
    Number(hours) * 3600 +
    Number(minutes) * 60 +
    Number(seconds) +
    (fraction ? Number(`0.${fraction}`) : 0)
  );
}

/**
 * The newest percentage in a piece of whisper-cli's stderr, which `-pp` fills
 * with `whisper_print_progress_callback: progress =  35%`. Null when the
 * piece holds none (most of stderr is model loading and timings).
 */
function parseProgress(chunk) {
  let latest = null;
  for (const match of String(chunk).matchAll(/progress\s*=\s*(\d{1,3})%/g)) {
    latest = Math.min(100, Number(match[1]));
  }
  return latest;
}

/**
 * The newest line whisper-cli printed to stdout, as it finishes each stretch
 * of speech: `[00:00:02.620 --> 00:00:06.040]   The Krebs cycle…`. The
 * percentages above only move every thirty seconds of audio or so; these
 * arrive continuously and say what was just heard.
 */
function parseLiveSegment(chunk) {
  let latest = null;
  const pattern = /\[(\d+:\d{2}:\d{2}\.\d+)\s*-->\s*(\d+:\d{2}:\d{2}\.\d+)\]\s*(.*)/g;
  for (const match of String(chunk).matchAll(pattern)) {
    const end = clockToSeconds(match[2]);
    if (end !== null) latest = { end, text: match[3].trim() };
  }
  return latest;
}

/** The length ffmpeg reports for its input: `Duration: 00:52:14.08, start: …`. */
function parseDuration(chunk) {
  const match = /Duration:\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/.exec(String(chunk));
  return match ? clockToSeconds(match[1]) : null;
}

/** How far ffmpeg has got, from the newest `time=00:10:02.31` in its stderr. */
function parseFfmpegTime(chunk) {
  let latest = null;
  for (const match of String(chunk).matchAll(/time=\s*(\d+:\d{2}:\d{2}(?:\.\d+)?)/g)) {
    latest = clockToSeconds(match[1]);
  }
  return latest;
}

/** Whisper's markers for audio with no speech in it, which are not notes. */
const NON_SPEECH = /^[\[(]\s*(blank_audio|silence|music|inaudible|no audio)\s*[\])]$/i;

/** A pause this long between two segments starts a new paragraph. */
const PARAGRAPH_PAUSE_SECONDS = 1.5;
/** Without pauses, a paragraph still ends at the first full stop past this. */
const PARAGRAPH_CHARS = 600;

/**
 * Turns whisper-cli's `-oj` file into what the database stores.
 *
 * Whisper's `offsets` are milliseconds; segments come out in seconds, numbered
 * from zero, trimmed, with the silent ones dropped.
 */
function parseWhisperJson(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const entries = Array.isArray(data?.transcription) ? data.transcription : [];

  const segments = [];
  for (const entry of entries) {
    const text = typeof entry?.text === "string" ? entry.text.replace(/\s+/g, " ").trim() : "";
    if (!text || NON_SPEECH.test(text)) continue;

    const start = Number(entry?.offsets?.from) / 1000;
    const end = Number(entry?.offsets?.to) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    segments.push({ id: segments.length, start, end: Math.max(start, end), text });
  }

  return {
    segments,
    fullText: joinSegments(segments),
    duration: segments.length > 0 ? segments[segments.length - 1].end : 0,
  };
}

/** The transcript as prose: sentences run together, paragraphs at the pauses. */
function joinSegments(segments) {
  const paragraphs = [];
  let current = "";
  let previousEnd = null;

  for (const segment of segments) {
    const paused =
      previousEnd !== null && segment.start - previousEnd >= PARAGRAPH_PAUSE_SECONDS;
    const longEnough = current.length >= PARAGRAPH_CHARS && /[.?!]["')\]]?$/.test(current);

    if (current && (paused || longEnough)) {
      paragraphs.push(current);
      current = "";
    }
    current = current ? `${current} ${segment.text}` : segment.text;
    previousEnd = segment.end;
  }
  if (current) paragraphs.push(current);

  return paragraphs.join("\n\n");
}

/** A title to start with: the file's name without its extension or underscores. */
function titleFromFile(file) {
  const base = path.basename(String(file), path.extname(String(file)));
  const title = base.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return title || "Untitled lecture";
}

module.exports = {
  AUDIO_EXTENSIONS,
  clockToSeconds,
  isSupportedRecording,
  joinSegments,
  parseDuration,
  parseFfmpegTime,
  parseLiveSegment,
  parseProgress,
  parseWhisperJson,
  titleFromFile,
};
