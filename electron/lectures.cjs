/**
 * Lecture transcription, entirely on this computer.
 *
 * A recording goes through two bundled command-line programs, both run from
 * here so the window never waits on either:
 *
 *  1. `ffmpeg` turns whatever was recorded (.mp3, .m4a, .wav, .aac, or the
 *     sound from a .mov or .mp4) into the 16 kHz mono WAV Whisper reads, and
 *     in the same pass a small .m4a to play back beside the transcript.
 *  2. `whisper-cli` (whisper.cpp) writes the transcript as JSON, printing its
 *     progress as it goes, which is forwarded to the window.
 *
 * The result is one row in `lecture_transcripts`. No audio and no text leaves
 * the machine; the only network use is downloading a Whisper model, once, when
 * the student asks for it.
 *
 * A lecture can also be recorded in the app. The window owns the microphone
 * and hands the sound over a few seconds at a time; it is appended to a file
 * in `lecture-recordings/` as it arrives, so a crash, a flat battery or a
 * closed lid costs the last few seconds and not the lecture. A recording that
 * ends, however it ends, becomes a row marked `pending` with its audio, to be
 * transcribed straight away or whenever the student likes.
 *
 * `createLectures` holds everything that does not need Electron, so it can be
 * driven from plain Node. `registerLectures` puts it behind IPC.
 */
const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AUDIO_EXTENSIONS,
  isSupportedRecording,
  parseDuration,
  parseFfmpegTime,
  parseLiveSegment,
  parseProgress,
  parseWhisperJson,
  titleFromFile,
} = require("./lecture-parse.cjs");

const MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/**
 * The Whisper models on offer, English-only builds of each. Sizes and hashes
 * are those of the published files; a download that does not match is thrown
 * away rather than handed to whisper-cli.
 */
const MODELS = [
  {
    id: "base.en",
    name: "Base",
    file: "ggml-base.en.bin",
    bytes: 147_964_211,
    sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
    recommended: true,
    description: "Fast, and accurate enough for most lectures.",
  },
  {
    id: "small.en",
    name: "Small",
    file: "ggml-small.en.bin",
    bytes: 487_614_201,
    sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
    recommended: false,
    description:
      "Better with medical and biology terms and with quiet recordings. About three times slower.",
  },
];

/** The window is told about changes at most this often. */
const NOTIFY_INTERVAL_MS = 200;

/** How often a recording in progress is checked for speech to preview. */
const LIVE_TICK_MS = 4000;
/** New sound a preview pass waits for: about 12 seconds of Opus at 48 kbit/s. */
const LIVE_MIN_BYTES = 72_000;
/** Shorter than this and Whisper has too little to go on. */
const LIVE_MIN_SECONDS = 5;
/** Preview lines kept for the window; the full transcript is made afterwards. */
const LIVE_MAX_LINES = 400;

/** The window sends about 20 kB every few seconds; anything near this is not that. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
/** Around ninety hours of speech. */
const MAX_RECORDING_BYTES = 2 * 1024 ** 3;

/** Why a recording ended without the student ending it, as they are told. */
const ENDED_BECAUSE = {
  sleep: "The computer went to sleep, so the recording was stopped.",
  closed: "The window was closed or reloaded while recording.",
  mic: "The microphone was disconnected, so the recording was stopped.",
  recovered: "The app quit while recording.",
};

/** Lines of a tool's stderr kept to explain a failure. */
const STDERR_TAIL_CHARS = 4000;

class Cancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "Cancelled";
  }
}

/** Where the two programs are: inside the app when packaged, `vendor/` when not. */
function defaultToolsDir(packaged) {
  if (packaged) return path.join(process.resourcesPath, "audio-tools");
  const name = { darwin: "mac", win32: "win", linux: "linux" }[process.platform];
  return path.join(__dirname, "..", "vendor", "audio-tools", `${name}-${process.arch}`);
}

/**
 * @param {object} options
 * @param {string} options.baseDir   Holds `whisper-models/` and `whisper-tmp/` (the app's userData).
 * @param {string} options.dbPath    The SQLite file transcripts are saved to.
 * @param {string} options.toolsDir  The folder with whisper-cli and ffmpeg.
 * @param {(snapshot: object) => void} [options.onChange]
 * @param {(busy: boolean) => void} [options.onBusy]  Called when work starts and when it all stops.
 * @param {(recording: boolean) => void} [options.onRecording]  Called when the microphone starts and stops being recorded.
 */
function createLectures({ baseDir, dbPath, toolsDir, onChange, onBusy, onRecording }) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const tools = {
    whisper: process.env.WHISPER_CLI_PATH || path.join(toolsDir, `whisper-cli${exe}`),
    ffmpeg: process.env.FFMPEG_PATH || path.join(toolsDir, `ffmpeg${exe}`),
  };

  const modelsDir = path.join(baseDir, "whisper-models");
  const tmpRoot = path.join(baseDir, "whisper-tmp");
  /** Recordings being made. Not in `whisper-tmp`: these must outlive a crash. */
  const recordingsDir = path.join(baseDir, "lecture-recordings");
  /** Playback copies sit beside the database, so a backup of one finds the other. */
  const audioDir = path.join(path.dirname(dbPath), "lectures");

  /** modelId -> { received, verifying, error, abort } while one is in flight or has failed. */
  const downloads = new Map();
  /** Model id to the run still touching its `.partial`, cancelled ones included. */
  const fetching = new Map();
  /** Every job not yet dismissed, oldest first. */
  const jobs = [];
  /** jobId -> the running child process, to kill on cancel. */
  const children = new Map();
  let working = false;

  /** The one recording being made, or null. */
  let recording = null;
  let liveTimer = null;
  /** { id, text, lectureId } about a recording that ended on its own, until dismissed. */
  let notice = null;

  // Whatever a crash or a force-quit left half-converted.
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  /* ------------------------------------------------------------ state */

  function toolsProblem() {
    for (const [name, file] of Object.entries(tools)) {
      if (!fs.existsSync(file)) {
        return `The transcription tools are missing from this copy of the app (${name}).`;
      }
    }
    return null;
  }

  function modelPath(model) {
    return path.join(modelsDir, model.file);
  }

  /** Downloaded and whole. The hash was checked before the file got this name. */
  function modelReady(model) {
    try {
      return fs.statSync(modelPath(model)).size === model.bytes;
    } catch {
      return false;
    }
  }

  function modelState(model) {
    const download = downloads.get(model.id);
    const ready = modelReady(model);
    let status = ready ? "ready" : "missing";
    if (download?.error) status = "error";
    else if (download?.verifying) status = "verifying";
    else if (download) status = "downloading";

    return {
      id: model.id,
      name: model.name,
      file: model.file,
      bytes: model.bytes,
      description: model.description,
      recommended: model.recommended,
      status,
      receivedBytes: ready ? model.bytes : (download?.received ?? 0),
      error: download?.error ?? null,
    };
  }

  function snapshot() {
    const problem = toolsProblem();
    return {
      available: problem === null,
      unavailableReason: problem,
      extensions: AUDIO_EXTENSIONS,
      models: MODELS.map(modelState),
      jobs: jobs.map((job) => ({
        id: job.id,
        lectureId: job.lectureId,
        title: job.title,
        fileName: job.fileName,
        modelId: job.modelId,
        status: job.status,
        progress: job.progress,
        preview: job.preview,
        error: job.error,
      })),
      recording: recording
        ? {
            id: recording.id,
            title: recording.title,
            startedAt: recording.startedAt,
            paused: recording.paused,
            stopped: recording.stopped,
            saving: recording.saving,
            interrupted: recording.interrupted,
            live: {
              enabled: recording.live.enabled && liveModel(recording.live.modelId) !== null,
              lines: recording.live.lines,
            },
          }
        : null,
      notice,
    };
  }

  let notifyTimer = null;
  let lastNotify = 0;

  /** Tells the window, now if it has been a moment and shortly if not. */
  function changed() {
    if (!onChange) return;
    const wait = NOTIFY_INTERVAL_MS - (Date.now() - lastNotify);
    if (wait <= 0) {
      lastNotify = Date.now();
      onChange(snapshot());
    } else if (!notifyTimer) {
      notifyTimer = setTimeout(() => {
        notifyTimer = null;
        lastNotify = Date.now();
        onChange(snapshot());
      }, wait);
    }
  }

  /** For news that should not wait its turn: the laptop is about to sleep. */
  function changedNow() {
    clearTimeout(notifyTimer);
    notifyTimer = null;
    lastNotify = Date.now();
    onChange?.(snapshot());
  }

  function reportBusy() {
    const busy =
      jobs.some((job) => isActive(job)) ||
      [...downloads.values()].some((download) => !download.error);
    onBusy?.(busy);
  }

  /* ----------------------------------------------------------- models */

  function findModel(modelId) {
    return MODELS.find((model) => model.id === modelId) ?? null;
  }

  function downloadModel(modelId) {
    const model = findModel(modelId);
    if (!model) return { ok: false, error: "Unknown model." };
    if (modelReady(model)) return { ok: true };

    const existing = downloads.get(model.id);
    if (existing && !existing.error && !existing.abort.signal.aborted) return { ok: true };

    const download = { received: 0, verifying: false, error: null, abort: new AbortController() };
    downloads.set(model.id, download);
    changed();
    reportBusy();

    // A cancelled run may still be closing its file; the next one starts after it.
    const previous = fetching.get(model.id) ?? Promise.resolve();
    const forget = () => {
      if (downloads.get(model.id) === download) downloads.delete(model.id);
    };
    const run = previous
      .then(() => {
        if (download.abort.signal.aborted) throw new Error("Cancelled.");
        return fetchModel(model, download);
      })
      .then(forget)
      .catch((error) => {
        if (download.abort.signal.aborted) forget();
        else download.error = downloadError(error);
      })
      .finally(() => {
        if (fetching.get(model.id) === run) fetching.delete(model.id);
        changed();
        reportBusy();
      });
    fetching.set(model.id, run);

    return { ok: true };
  }

  /**
   * Streams the model to `<file>.partial`, picking up where an interrupted
   * download stopped, and gives it its real name only once its hash matches.
   */
  async function fetchModel(model, download) {
    fs.mkdirSync(modelsDir, { recursive: true });
    const target = modelPath(model);
    const partial = `${target}.partial`;

    let have = 0;
    try {
      have = fs.statSync(partial).size;
    } catch {
      // Nothing to resume.
    }
    // A leftover as large as the whole file failed its check last time.
    if (have >= model.bytes) {
      fs.rmSync(partial, { force: true });
      have = 0;
    }

    const response = await fetch(`${MODEL_BASE_URL}/${model.file}`, {
      headers: have > 0 ? { Range: `bytes=${have}-` } : {},
      redirect: "follow",
      signal: download.abort.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`The download server answered ${response.status}.`);
    }

    // 206 continues the file; a plain 200 is the whole thing from the start.
    // A 206 for some other range than the one asked for cannot be appended.
    const resuming = have > 0 && response.status === 206;
    if (resuming) {
      const range = /^bytes (\d+)-/.exec(response.headers.get("content-range") ?? "");
      if (!range || Number(range[1]) !== have) {
        fs.rmSync(partial, { force: true });
        throw new Error("The download could not continue where it stopped. Try again.");
      }
    }
    download.received = resuming ? have : 0;
    changed();

    const file = fs.createWriteStream(partial, { flags: resuming ? "a" : "w" });
    try {
      for await (const chunk of response.body) {
        if (!file.write(chunk)) await new Promise((resolve) => file.once("drain", resolve));
        download.received += chunk.length;
        changed();
      }
    } finally {
      await new Promise((resolve) => file.end(resolve));
    }

    download.verifying = true;
    changed();
    const actual = await sha256File(partial);
    if (actual !== model.sha256) {
      fs.rmSync(partial, { force: true });
      throw new Error("The downloaded file was damaged on the way. Try again.");
    }
    fs.renameSync(partial, target);
  }

  function downloadError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error?.code === "ENOSPC") return "There is not enough free disk space for this model.";
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network|terminated/i.test(message)) {
      return "The download was interrupted. Check your connection and try again; it continues where it stopped.";
    }
    return message;
  }

  function cancelDownload(modelId) {
    const download = downloads.get(modelId);
    if (!download) return { ok: true };
    if (download.error) downloads.delete(modelId);
    else download.abort.abort();
    changed();
    return { ok: true };
  }

  function deleteModel(modelId) {
    const model = findModel(modelId);
    if (!model) return { ok: false, error: "Unknown model." };
    if (jobs.some((job) => isActive(job) && job.modelId === modelId)) {
      return { ok: false, error: "A lecture is being transcribed with this model." };
    }

    cancelDownload(modelId);
    downloads.delete(modelId);
    fs.rmSync(modelPath(model), { force: true });
    fs.rmSync(`${modelPath(model)}.partial`, { force: true });
    changed();
    return { ok: true };
  }

  /* ------------------------------------------------------------- jobs */

  function isActive(job) {
    return !["done", "error", "cancelled"].includes(job.status);
  }

  /**
   * Queues recordings for transcription. Each path is checked here, since it
   * arrives from the window: a real file, of a kind ffmpeg is meant to open.
   */
  function transcribe({ paths, modelId }) {
    const problem = toolsProblem();
    if (problem) return { ok: false, error: problem };

    const model = findModel(modelId);
    if (!model) return { ok: false, error: "Unknown model." };
    if (!modelReady(model)) return { ok: false, error: "Download that model first." };

    if (!Array.isArray(paths) || paths.length === 0) {
      return { ok: false, error: "Choose a recording first." };
    }

    const accepted = [];
    const rejected = [];
    for (const file of paths) {
      if (typeof file !== "string" || !path.isAbsolute(file)) continue;
      let stat = null;
      try {
        stat = fs.statSync(file);
      } catch {
        // Reported below with the rest.
      }
      if (!stat?.isFile() || !isSupportedRecording(file)) {
        rejected.push(path.basename(file));
        continue;
      }
      accepted.push(file);
    }

    for (const file of accepted) {
      jobs.push({
        id: randomUUID(),
        lectureId: null,
        source: file,
        fileName: path.basename(file),
        title: titleFromFile(file),
        modelId: model.id,
        status: "queued",
        progress: 0,
        preview: "",
        error: null,
        cancelled: false,
      });
    }

    changed();
    void work();
    return { ok: accepted.length > 0, queued: accepted.length, rejected };
  }

  /** One recording at a time: Whisper already uses every core it is given. */
  async function work() {
    if (working) return;
    working = true;
    reportBusy();
    try {
      for (;;) {
        const job = jobs.find((candidate) => candidate.status === "queued");
        if (!job) break;
        await runJob(job);
      }
    } finally {
      working = false;
      reportBusy();
    }
  }

  async function runJob(job) {
    const model = findModel(job.modelId);
    const tmp = path.join(tmpRoot, job.id);
    // A lecture recorded in the app already has its row and its audio.
    const lectureId = job.lectureId ?? randomUUID();

    try {
      fs.mkdirSync(tmp, { recursive: true });

      setStatus(job, "converting");
      const duration = await convert(job, tmp);

      setStatus(job, "transcribing");
      await recognise(job, model, tmp, duration);

      setStatus(job, "saving");
      const result = parseWhisperJson(fs.readFileSync(path.join(tmp, "out.json"), "utf8"));

      if (job.existing) {
        const saved = fillTranscript({
          id: lectureId,
          duration: duration ?? result.duration,
          fullText: result.fullText,
          segments: result.segments,
        });
        if (!saved) throw new Error("This lecture was deleted while it was being transcribed.");
      } else {
        fs.mkdirSync(audioDir, { recursive: true });
        const audioName = `${lectureId}.m4a`;
        fs.copyFileSync(path.join(tmp, "playback.m4a"), path.join(audioDir, audioName));

        try {
          saveTranscript({
            id: lectureId,
            title: job.title,
            audioPath: audioName,
            duration: duration ?? result.duration,
            fullText: result.fullText,
            segments: result.segments,
          });
        } catch (error) {
          fs.rmSync(path.join(audioDir, audioName), { force: true });
          throw error;
        }
      }

      job.lectureId = lectureId;
      job.progress = 100;
      setStatus(job, "done");
    } catch (error) {
      if (job.cancelled || error instanceof Cancelled) {
        setStatus(job, "cancelled");
      } else {
        job.error = error instanceof Error ? error.message : String(error);
        setStatus(job, "error");
      }
    } finally {
      children.delete(job.id);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  function setStatus(job, status) {
    job.status = status;
    if (status === "converting" || status === "transcribing") job.progress = 0;
    changed();
  }

  /**
   * Runs one of the tools to the end. `onStdout`/`onStderr` see the output as
   * it arrives; a non-zero exit rejects with the last of what stderr said.
   */
  function runTool(job, file, argv, { cwd, onStdout, onStderr }) {
    return new Promise((resolve, reject) => {
      if (job.cancelled) return reject(new Cancelled());

      const toolDir = path.dirname(file);
      const child = spawn(file, argv, {
        cwd,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        // The Linux build's libraries sit beside it; its RUNPATH says so too.
        env:
          process.platform === "linux"
            ? {
                ...process.env,
                LD_LIBRARY_PATH: [toolDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
              }
            : process.env,
      });
      children.set(job.id, child);

      let tail = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => onStdout?.(chunk));
      child.stderr.on("data", (chunk) => {
        tail = (tail + chunk).slice(-STDERR_TAIL_CHARS);
        onStderr?.(chunk);
      });

      child.on("error", (error) => {
        children.delete(job.id);
        reject(error);
      });
      child.on("close", (code) => {
        children.delete(job.id);
        if (job.cancelled) reject(new Cancelled());
        else if (code === 0) resolve(tail);
        else reject(Object.assign(new Error(`exited with ${code}`), { stderr: tail, code }));
      });
    });
  }

  /**
   * Recording to `in.wav` (for Whisper) and `playback.m4a`; returns its length
   * in seconds. A lecture recorded in the app is its own playback copy already.
   */
  async function convert(job, tmp) {
    let duration = null;
    const playback = job.existing
      ? []
      : [
          // To listen back to. Speech at this rate is about 20 MB an hour.
          "-map", "0:a:0", "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "48k",
          "-movflags", "+faststart",
          path.join(tmp, "playback.m4a"),
        ];
    try {
      await runTool(
        job,
        tools.ffmpeg,
        [
          "-nostdin", "-hide_banner", "-y",
          "-i", job.source,
          // What Whisper reads: 16 kHz, 16-bit, one channel.
          "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
          path.join(tmp, "in.wav"),
          ...playback,
        ],
        {
          onStderr(chunk) {
            duration ??= parseDuration(chunk);
            const at = parseFfmpegTime(chunk);
            if (at !== null && duration) {
              job.progress = Math.min(100, Math.round((at / duration) * 100));
              changed();
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      const said = String(error?.stderr ?? "");
      if (/matches no streams|does not contain any stream/i.test(said)) {
        throw new Error("There is no sound in this file.");
      }
      if (/Invalid data found|moov atom not found|could not find codec/i.test(said)) {
        throw new Error("This file could not be read as a recording. It may be damaged.");
      }
      if (/No space left/i.test(said)) {
        throw new Error("There is not enough free disk space to convert this recording.");
      }
      throw new Error(`The recording could not be converted (${lastLine(said) || error.message}).`);
    }
    return duration;
  }

  /** `in.wav` to `out.json`, reporting how far through the recording Whisper is. */
  async function recognise(job, model, tmp, duration) {
    // Leave a core for the window, and stop where more threads stop helping.
    const threads = Math.max(1, Math.min(8, os.availableParallelism() - 1));

    // whisper-cli on Windows reads its arguments in the system code page, so a
    // user folder with letters outside it would not open. Every path given to
    // it is therefore relative to `baseDir`, and plain ASCII.
    const relative = (file) => path.relative(baseDir, file);

    try {
      await runTool(
        job,
        tools.whisper,
        [
          "-m", relative(modelPath(model)),
          "-f", relative(path.join(tmp, "in.wav")),
          "-oj",
          "-of", relative(path.join(tmp, "out")),
          "-pp",
          "-l", "en",
          "-t", String(threads),
        ],
        {
          cwd: baseDir,
          onStderr(chunk) {
            const percent = parseProgress(chunk);
            if (percent !== null && percent > job.progress) {
              job.progress = percent;
              changed();
            }
          },
          onStdout(chunk) {
            const live = parseLiveSegment(chunk);
            if (!live) return;
            if (live.text) job.preview = live.text;
            if (duration) {
              // Never 100 from here: that is for when the file is written.
              const percent = Math.min(99, Math.floor((live.end / duration) * 100));
              if (percent > job.progress) job.progress = percent;
            }
            changed();
          },
        },
      );
    } catch (error) {
      if (error instanceof Cancelled) throw error;
      const said = String(error?.stderr ?? "");
      if (/failed to (load|initialize)|bad magic|invalid model/i.test(said)) {
        throw new Error("The model file could not be loaded. Delete it and download it again.");
      }
      throw new Error(`Transcription stopped (${lastLine(said) || error.message}).`);
    }

    if (!fs.existsSync(path.join(tmp, "out.json"))) {
      throw new Error("Transcription finished without producing a transcript.");
    }
  }

  function withDatabase(run) {
    const Database = require("better-sqlite3");
    const sqlite = new Database(dbPath);
    try {
      // The Next server has the same file open; wait for it rather than fail.
      sqlite.pragma("busy_timeout = 10000");
      return run(sqlite);
    } finally {
      sqlite.close();
    }
  }

  function saveTranscript({ id, title, audioPath, duration, fullText, segments }) {
    withDatabase((sqlite) =>
      sqlite
        .prepare(
          `INSERT INTO lecture_transcripts
             (id, title, audio_path, duration_seconds, full_text, segments_json)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, title, audioPath, duration ?? null, fullText, JSON.stringify(segments)),
    );
  }

  /** A recorded lecture with no transcript yet. `startedAt` is when it was recorded. */
  function savePending({ id, title, audioPath, duration, startedAt }) {
    // The form SQLite's own `current_timestamp` takes: UTC, to the second.
    const created = new Date(startedAt).toISOString().slice(0, 19).replace("T", " ");
    withDatabase((sqlite) =>
      sqlite
        .prepare(
          `INSERT INTO lecture_transcripts
             (id, title, audio_path, duration_seconds, transcript_status, created_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(id, title, audioPath, duration ?? null, created),
    );
  }

  /** Gives a recorded lecture its transcript. False when the lecture is gone. */
  function fillTranscript({ id, duration, fullText, segments }) {
    return withDatabase(
      (sqlite) =>
        sqlite
          .prepare(
            `UPDATE lecture_transcripts
                SET full_text = ?, segments_json = ?, transcript_status = 'done',
                    duration_seconds = coalesce(?, duration_seconds),
                    updated_at = current_timestamp
              WHERE id = ?`,
          )
          .run(fullText, JSON.stringify(segments), duration ?? null, id).changes > 0,
    );
  }

  /**
   * Queues a lecture that was recorded in the app, and saved without a
   * transcript, to get one.
   */
  function transcribeLecture({ lectureId, modelId }) {
    const problem = toolsProblem();
    if (problem) return { ok: false, error: problem };

    const model = findModel(modelId);
    if (!model) return { ok: false, error: "Unknown model." };
    if (!modelReady(model)) return { ok: false, error: "Download that model first." };

    if (jobs.some((job) => isActive(job) && job.lectureId === lectureId)) return { ok: true };

    let row = null;
    try {
      row = withDatabase((sqlite) =>
        sqlite
          .prepare("SELECT title, audio_path AS audioPath FROM lecture_transcripts WHERE id = ?")
          .get(String(lectureId)),
      );
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (!row) return { ok: false, error: "That lecture no longer exists." };

    // Only ever a file of our own, in our own folder, whatever the row says.
    const source = row.audioPath ? path.join(audioDir, path.basename(row.audioPath)) : null;
    if (!source || !fs.existsSync(source)) {
      return { ok: false, error: "This lecture's recording was removed, so it cannot be transcribed." };
    }

    jobs.push({
      id: randomUUID(),
      lectureId: String(lectureId),
      existing: true,
      source,
      fileName: path.basename(source),
      title: row.title,
      modelId: model.id,
      status: "queued",
      progress: 0,
      preview: "",
      error: null,
      cancelled: false,
    });

    changed();
    void work();
    return { ok: true };
  }

  /* -------------------------------------------------------- recording */

  function recordingFiles(id) {
    return {
      audio: path.join(recordingsDir, `${id}.webm`),
      meta: path.join(recordingsDir, `${id}.json`),
    };
  }

  function writeMeta(id, meta) {
    try {
      fs.writeFileSync(recordingFiles(id).meta, JSON.stringify(meta));
    } catch {
      // Only the title of a recovered recording depends on it.
    }
  }

  function startRecording({ title, live, modelId }) {
    const problem = toolsProblem();
    if (problem) return { ok: false, error: problem };
    if (recording) return { ok: false, error: "A recording is already in progress." };

    const id = randomUUID();
    const startedAt = Date.now();
    const name = cleanTitle(title);
    try {
      fs.mkdirSync(recordingsDir, { recursive: true });
      fs.writeFileSync(recordingFiles(id).audio, "");
    } catch (error) {
      return { ok: false, error: `The recording could not be started (${error.message}).` };
    }
    writeMeta(id, { title: name, startedAt });

    recording = {
      id,
      title: name,
      startedAt,
      bytes: 0,
      paused: false,
      stopped: false,
      saving: false,
      interrupted: null,
      live: {
        enabled: Boolean(live),
        modelId: String(modelId ?? ""),
        /** Seconds of the recording already turned into lines. */
        at: 0,
        heardBytes: 0,
        lines: [],
        job: null,
      },
    };
    liveTimer = setInterval(() => void previewRecording(), LIVE_TICK_MS);
    liveTimer.unref?.();

    onRecording?.(true);
    changed();
    return { ok: true, id };
  }

  /** The next few seconds of sound from the window, added to the file. */
  function appendRecording({ id, chunk }) {
    if (!recording || recording.id !== id || recording.saving) {
      return { ok: false, error: "That recording has ended." };
    }

    let data = null;
    if (chunk instanceof ArrayBuffer) data = Buffer.from(chunk);
    else if (ArrayBuffer.isView(chunk)) {
      data = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    }
    if (!data || data.length > MAX_CHUNK_BYTES) return { ok: false, error: "Not a recording." };
    if (recording.bytes + data.length > MAX_RECORDING_BYTES) {
      return { ok: false, error: "This recording has reached the longest the app can keep." };
    }

    try {
      fs.appendFileSync(recordingFiles(id).audio, data);
    } catch (error) {
      return {
        ok: false,
        error:
          error?.code === "ENOSPC"
            ? "The disk is full, so the recording cannot continue."
            : `The recording could not be written (${error.message}).`,
      };
    }
    recording.bytes += data.length;
    return { ok: true };
  }

  function updateRecording({ id, title, paused, live, stopped }) {
    if (!recording || recording.id !== id) return { ok: false, error: "That recording has ended." };

    if (typeof title === "string") {
      recording.title = cleanTitle(title);
      writeMeta(id, { title: recording.title, startedAt: recording.startedAt });
    }
    if (typeof paused === "boolean") recording.paused = paused;
    if (typeof live === "boolean") recording.live.enabled = live;
    // Stopped, with the student still deciding what to do with it: the
    // microphone is off, so the screen no longer has to stay on.
    if (stopped === true && !recording.stopped) {
      recording.stopped = true;
      onRecording?.(false);
    }
    changed();
    return { ok: true };
  }

  /** The fast model when it is there: a preview should keep up with the speaker. */
  function liveModel(modelId) {
    const quick = MODELS.find((model) => model.recommended && modelReady(model));
    if (quick) return quick;
    const chosen = findModel(modelId);
    if (chosen && modelReady(chosen)) return chosen;
    return MODELS.find((model) => modelReady(model)) ?? null;
  }

  /**
   * The live transcript: every so often, the sound since the last line is cut
   * out of the growing file and given to Whisper. Whisper wants whole
   * sentences, so the newest line, usually cut off mid-thought, is held back
   * and heard again with what follows it.
   *
   * This is a preview and nothing is saved from it; the transcript is made
   * from the whole recording afterwards, where Whisper has the full context.
   * A failure here is therefore silent, and a queued job always goes first.
   */
  async function previewRecording() {
    const current = recording;
    if (!current || current.saving || current.paused || !current.live.enabled) return;
    // Once stopped, a last pass picks up the final sentences and that is all.
    if (current.stopped && current.live.heardBytes >= current.bytes) return;

    const live = current.live;
    if (live.job || working) return;
    if (!current.stopped && current.bytes - live.heardBytes < LIVE_MIN_BYTES) return;
    const model = liveModel(live.modelId);
    if (!model) return;

    const job = { id: `live-${current.id}`, cancelled: false };
    live.job = job;
    const tmp = path.join(tmpRoot, job.id);
    const relative = (file) => path.relative(baseDir, file);

    try {
      fs.mkdirSync(tmp, { recursive: true });
      const heard = current.bytes;
      const wav = path.join(tmp, "live.wav");

      await runTool(
        job,
        tools.ffmpeg,
        [
          "-nostdin", "-hide_banner", "-y",
          "-i", recordingFiles(current.id).audio,
          // After `-i`: the file has no index while it is still being written.
          "-ss", String(live.at),
          "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
          wav,
        ],
        {},
      );

      // 16 kHz, 16-bit, mono: 32,000 bytes a second after the header.
      const seconds = Math.max(0, (fs.statSync(wav).size - 44) / 32_000);
      if (seconds < LIVE_MIN_SECONDS) {
        if (current.stopped) live.heardBytes = heard;
        return;
      }

      await runTool(
        job,
        tools.whisper,
        [
          "-m", relative(modelPath(model)),
          "-f", relative(wav),
          "-oj",
          "-of", relative(path.join(tmp, "live")),
          "-l", "en",
          // Half the cores: the app is being used while this runs.
          "-t", String(Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)))),
        ],
        { cwd: baseDir },
      );

      const { segments } = parseWhisperJson(fs.readFileSync(path.join(tmp, "live.json"), "utf8"));
      const last = segments[segments.length - 1];
      const holdBack = !current.stopped && segments.length > 1 && last.start >= 1;
      const kept = holdBack ? segments.slice(0, -1) : segments;

      for (const segment of kept) {
        live.lines.push({ at: live.at + segment.start, text: segment.text });
      }
      if (live.lines.length > LIVE_MAX_LINES) live.lines.splice(0, live.lines.length - LIVE_MAX_LINES);
      live.at += holdBack ? last.start : seconds;
      live.heardBytes = heard;
      changed();
    } catch {
      // The next pass tries again from the same place.
    } finally {
      live.job = null;
      children.delete(job.id);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  /**
   * The recording as the app keeps it: a small .m4a beside the database and a
   * `pending` row. Throws an error marked `empty` when there was no sound.
   */
  async function storeRecording({ id, title, startedAt }) {
    const files = recordingFiles(id);
    const lectureId = randomUUID();
    const part = path.join(recordingsDir, `${id}.part`);
    const job = { id: `store-${id}`, cancelled: false };

    let size = 0;
    try {
      size = fs.statSync(files.audio).size;
    } catch {
      // Treated as empty below.
    }
    const empty = () => Object.assign(new Error("Nothing was recorded."), { empty: true });
    if (size === 0) throw empty();

    let duration = null;
    try {
      await runTool(
        job,
        tools.ffmpeg,
        [
          "-nostdin", "-hide_banner", "-y",
          "-i", files.audio,
          "-map", "0:a:0", "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "48k",
          "-movflags", "+faststart",
          "-f", "mp4",
          part,
        ],
        {
          onStderr(chunk) {
            duration = parseFfmpegTime(chunk) ?? duration;
          },
        },
      );
    } catch (error) {
      fs.rmSync(part, { force: true });
      const said = String(error?.stderr ?? "");
      if (/Invalid data found|matches no streams|does not contain any stream|EBML header/i.test(said)) {
        throw empty();
      }
      if (/No space left/i.test(said)) {
        throw new Error("There is not enough free disk space to save this recording.");
      }
      throw new Error(`The recording could not be saved (${lastLine(said) || error.message}).`);
    }
    if (!duration || duration < 0.5) {
      fs.rmSync(part, { force: true });
      throw empty();
    }

    const audioName = `${lectureId}.m4a`;
    const kept = path.join(audioDir, audioName);
    try {
      fs.mkdirSync(audioDir, { recursive: true });
      fs.copyFileSync(part, kept);
      savePending({ id: lectureId, title, audioPath: audioName, duration, startedAt });
    } catch (error) {
      fs.rmSync(kept, { force: true });
      throw error;
    } finally {
      fs.rmSync(part, { force: true });
    }

    fs.rmSync(files.audio, { force: true });
    fs.rmSync(files.meta, { force: true });
    return { lectureId, duration };
  }

  function setNotice(text, lectureId = null) {
    notice = { id: randomUUID(), text, lectureId };
  }

  /**
   * Ends the recording. `transcribe` and `later` both save it first, so the
   * lecture is safe before Whisper starts; `discard` throws it away. `reason`
   * is set when it ended without the student asking, who is then told why.
   */
  async function finishRecording({ id, action, title, modelId, reason }) {
    const current = recording;
    if (!current || current.id !== id || current.saving) {
      return { ok: false, error: "That recording has already ended." };
    }

    current.saving = true;
    clearInterval(liveTimer);
    liveTimer = null;
    if (current.live.job) {
      current.live.job.cancelled = true;
      children.get(current.live.job.id)?.kill();
    }
    onRecording?.(false);
    changed();

    const files = recordingFiles(id);
    const name = typeof title === "string" && title.trim() ? cleanTitle(title) : current.title;
    const why = ENDED_BECAUSE[reason] ?? null;

    try {
      if (action === "discard") {
        fs.rmSync(files.audio, { force: true });
        fs.rmSync(files.meta, { force: true });
        return { ok: true, lectureId: null, transcribing: false };
      }

      let stored = null;
      try {
        stored = await storeRecording({ id, title: name, startedAt: current.startedAt });
      } catch (error) {
        if (error?.empty) {
          fs.rmSync(files.audio, { force: true });
          fs.rmSync(files.meta, { force: true });
        }
        // Otherwise the file stays where it is, and the next launch tries again.
        const message = error instanceof Error ? error.message : String(error);
        if (why) setNotice(`${why} ${message}`);
        return { ok: false, error: message };
      }

      let transcribing = false;
      if (action === "transcribe") {
        transcribing = transcribeLecture({ lectureId: stored.lectureId, modelId }).ok;
      }
      if (why) {
        setNotice(
          `${why} “${name}” is saved, ready to transcribe whenever you like.`,
          stored.lectureId,
        );
      }
      return { ok: true, lectureId: stored.lectureId, transcribing };
    } finally {
      if (recording === current) recording = null;
      changed();
    }
  }

  /** The window that was recording is gone, or never answered: save what there is. */
  function abandonRecording(reason) {
    if (!recording || recording.saving) return Promise.resolve({ ok: true });
    return finishRecording({ id: recording.id, action: "later", reason });
  }

  /**
   * The computer is going to sleep, which stops the microphone. The window is
   * asked to hand over what it still holds and end the recording; if it has
   * not by a little after waking, `abandonInterrupted` ends it without.
   */
  function interruptRecording(reason) {
    if (!recording || recording.saving) return;
    recording.interrupted = reason;
    changedNow();
  }

  function abandonInterrupted() {
    if (recording?.interrupted) void abandonRecording(recording.interrupted);
  }

  function dismissNotice() {
    notice = null;
    changed();
    return { ok: true };
  }

  /**
   * Recordings left behind by a crash, a force-quit or a flat battery. Each
   * becomes a lecture to transcribe later, and the student is told.
   */
  async function recoverRecordings() {
    let names = [];
    try {
      names = fs.readdirSync(recordingsDir);
    } catch {
      return;
    }
    if (toolsProblem()) return;

    for (const name of names) {
      if (name.endsWith(".part")) fs.rmSync(path.join(recordingsDir, name), { force: true });
    }

    for (const name of names) {
      if (!name.endsWith(".webm")) continue;
      const id = name.slice(0, -".webm".length);
      if (recording?.id === id) continue;

      const files = recordingFiles(id);
      let meta = {};
      try {
        meta = JSON.parse(fs.readFileSync(files.meta, "utf8"));
      } catch {
        // A recording without its note is still a recording.
      }
      const startedAt = Number.isFinite(meta?.startedAt)
        ? meta.startedAt
        : fs.statSync(files.audio).mtimeMs;
      const title = `${cleanTitle(meta?.title)} (recovered)`;

      try {
        const stored = await storeRecording({ id, title, startedAt });
        setNotice(
          `${ENDED_BECAUSE.recovered} “${title}” was recovered and is ready to transcribe.`,
          stored.lectureId,
        );
        changed();
      } catch (error) {
        if (error?.empty) {
          fs.rmSync(files.audio, { force: true });
          fs.rmSync(files.meta, { force: true });
        }
      }
    }
  }

  const recovered = recoverRecordings().catch(() => {});

  function cancelJob(jobId) {
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (!job || !isActive(job)) return { ok: true };

    job.cancelled = true;
    if (job.status === "queued") job.status = "cancelled";
    children.get(job.id)?.kill();
    changed();
    return { ok: true };
  }

  /** Clears a finished, failed or cancelled job from the list. */
  function dismissJob(jobId) {
    const index = jobs.findIndex((candidate) => candidate.id === jobId);
    if (index !== -1 && !isActive(jobs[index])) jobs.splice(index, 1);
    changed();
    return { ok: true };
  }

  /** On quit: nothing is left running, and nothing half-converted is kept. */
  function shutdown() {
    for (const job of jobs) job.cancelled = true;
    for (const child of children.values()) child.kill();
    for (const download of downloads.values()) download.abort?.abort();
    clearInterval(liveTimer);
    // A recording in progress is left in `lecture-recordings/` on purpose: the
    // next launch turns it into a lecture.
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  return {
    snapshot,
    downloadModel,
    cancelDownload,
    deleteModel,
    transcribe,
    transcribeLecture,
    cancelJob,
    dismissJob,
    startRecording,
    appendRecording,
    updateRecording,
    finishRecording,
    abandonRecording,
    interruptRecording,
    abandonInterrupted,
    dismissNotice,
    recordingId: () => recording?.id ?? null,
    shutdown,
    /** Resolves when the queue is empty; for tests and scripts. */
    idle: () => work(),
    /** Resolves once recordings left by a crash have been dealt with. */
    recovered,
    /** One preview pass, now; for tests and scripts. */
    previewRecording,
  };
}

function cleanTitle(title) {
  const text = typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return text || "Untitled lecture";
}

function lastLine(text) {
  const lines = String(text).split(/\r?\n|\r/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1].slice(0, 200) : "";
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Puts transcription behind IPC for the app window (see app-preload.cjs).
 *
 * `fromApp` is the same check every other channel uses: only a page served by
 * this app's own server may call in. `getWindows` is who hears about progress.
 */
function registerLectures({
  app,
  ipcMain,
  dialog,
  powerSaveBlocker,
  powerMonitor,
  systemPreferences,
  shell,
  fromApp,
  getWindows,
}) {
  let blocker = null;
  let screenBlocker = null;
  let lectures = null;
  /** Stops watching the window that is recording. */
  let unwatch = null;

  // Built on first use: the database's path is only settled once the app has
  // started, and nothing can call in before its window exists.
  function core() {
    lectures ??= createLectures({
      baseDir: app.getPath("userData"),
      dbPath: process.env.DATABASE_URL,
      toolsDir: defaultToolsDir(app.isPackaged),
      onChange(snapshot) {
        for (const window of getWindows()) {
          if (!window.isDestroyed()) window.webContents.send("lectures:changed", snapshot);
        }
      },
      // An hour-long lecture should not stop because the laptop dozed off.
      onBusy(busy) {
        if (busy && blocker === null) {
          blocker = powerSaveBlocker.start("prevent-app-suspension");
        } else if (!busy && blocker !== null) {
          powerSaveBlocker.stop(blocker);
          blocker = null;
        }
      },
      // While the microphone is on, the screen stays on too: a display that
      // sleeps takes the computer with it a little later, and the recording.
      onRecording(recording) {
        if (recording && screenBlocker === null) {
          screenBlocker = powerSaveBlocker.start("prevent-display-sleep");
        } else if (!recording && screenBlocker !== null) {
          powerSaveBlocker.stop(screenBlocker);
          screenBlocker = null;
        }
      },
    });
    return lectures;
  }

  /**
   * The microphone lives in the window. If that window closes, reloads or
   * crashes, nothing more will arrive: keep what did.
   */
  function watchOwner(contents) {
    unwatch?.();
    const lost = () => void lectures?.abandonRecording("closed");
    contents.on("destroyed", lost);
    contents.on("did-navigate", lost);
    contents.on("render-process-gone", lost);
    unwatch = () => {
      contents.off("destroyed", lost);
      contents.off("did-navigate", lost);
      contents.off("render-process-gone", lost);
    };
  }

  // Closing the lid, or the battery running low, puts the computer to sleep
  // whatever any app asks for, and a sleeping computer does not record.
  powerMonitor.on("suspend", () => lectures?.interruptRecording("sleep"));
  powerMonitor.on("resume", () => {
    setTimeout(() => lectures?.abandonInterrupted(), 10_000);
  });

  const refused = { ok: false, error: "Not allowed." };
  const handle = (channel, run) =>
    ipcMain.handle(channel, (event, argument) => (fromApp(event) ? run(argument, event) : refused));

  handle("lectures:state", () => core().snapshot());
  handle("lectures:download-model", (modelId) => core().downloadModel(String(modelId)));
  handle("lectures:cancel-download", (modelId) => core().cancelDownload(String(modelId)));
  handle("lectures:delete-model", (modelId) => core().deleteModel(String(modelId)));
  handle("lectures:transcribe", (request) =>
    core().transcribe({ paths: request?.paths, modelId: String(request?.modelId) }),
  );
  handle("lectures:transcribe-lecture", (request) =>
    core().transcribeLecture({
      lectureId: String(request?.lectureId),
      modelId: String(request?.modelId),
    }),
  );
  handle("lectures:cancel-job", (jobId) => core().cancelJob(String(jobId)));
  handle("lectures:dismiss-job", (jobId) => core().dismissJob(String(jobId)));

  handle("lectures:record-start", (request, event) => {
    const result = core().startRecording({
      title: request?.title,
      live: request?.live === true,
      modelId: request?.modelId,
    });
    if (result.ok) watchOwner(event.sender);
    return result;
  });
  handle("lectures:record-chunk", (request) =>
    core().appendRecording({ id: String(request?.id), chunk: request?.chunk }),
  );
  handle("lectures:record-update", (request) =>
    core().updateRecording({
      id: String(request?.id),
      title: request?.title,
      paused: request?.paused,
      live: request?.live,
      stopped: request?.stopped,
    }),
  );
  handle("lectures:record-finish", (request) =>
    core().finishRecording({
      id: String(request?.id),
      action: ["transcribe", "later", "discard"].includes(request?.action)
        ? request.action
        : "later",
      title: request?.title,
      modelId: String(request?.modelId ?? ""),
      reason: typeof request?.reason === "string" ? request.reason : undefined,
    }),
  );
  handle("lectures:dismiss-notice", () => core().dismissNotice());

  // "granted", "denied", "restricted" or "not-determined" (never asked).
  handle("lectures:mic-access", () =>
    process.platform === "darwin" || process.platform === "win32"
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "granted",
  );
  handle("lectures:open-mic-settings", async () => {
    const target = {
      darwin: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
      win32: "ms-settings:privacy-microphone",
    }[process.platform];
    if (!target) return { ok: false, error: "Open your system's sound settings." };
    await shell.openExternal(target).catch(() => {});
    return { ok: true };
  });

  // The system's own file picker, so the window is handed paths it was shown.
  handle("lectures:pick-files", async () => {
    const [window] = getWindows();
    const options = {
      title: "Choose lecture recordings",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Recordings", extensions: AUDIO_EXTENSIONS }],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });

  app.on("before-quit", () => lectures?.shutdown());
}

module.exports = { MODELS, createLectures, defaultToolsDir, registerLectures };
