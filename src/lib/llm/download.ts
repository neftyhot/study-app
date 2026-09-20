/**
 * Background model download.
 *
 * The wizard hands off to this and moves on: the student picks a model, sees a
 * quiet progress chip, and keeps using the app while several gigabytes arrive.
 * Nothing about llama.cpp, quantisation, or file paths reaches them.
 *
 * Progress lives in the settings table rather than in memory so it survives a
 * page reload — and so the UI can simply poll one row instead of holding a
 * socket open.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type Db } from "@/db/client";
import {
  readDownload,
  SETTING,
  writeDownload,
  writeSetting,
  type DownloadState,
} from "@/lib/settings";

import { findModel } from "./catalog";

/** Progress is written at most this often; SQLite is not a progress bar. */
const PROGRESS_INTERVAL_MS = 750;

export function modelsRoot(): string {
  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.MODELS_DIR ?? "./data/models",
  );
}

/** In-process guard so two clicks cannot start the same download twice. */
const running = new Set<string>();

export function isDownloading(modelId: string): boolean {
  return running.has(modelId);
}

export type StartResult =
  | { started: true }
  | { started: false; reason: string };

export function startModelDownload(modelId: string, db?: Db): StartResult {
  const model = findModel(modelId);
  if (!model) return { started: false, reason: "Unknown model." };

  const target = db ?? createClient();
  const existing = readDownload(target);

  if (existing?.status === "downloading" && running.has(existing.modelId)) {
    return { started: false, reason: "A download is already running." };
  }
  if (running.has(modelId)) {
    return { started: false, reason: "That model is already downloading." };
  }

  running.add(modelId);
  writeDownload(
    {
      modelId,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: model.bytes,
    },
    target,
  );

  // Deliberately not awaited: the caller returns immediately and the student
  // carries on. Failures are recorded in the same row the UI already polls.
  void run(modelId).catch((error: unknown) => {
    record(
      {
        modelId,
        status: "failed",
        downloadedBytes: 0,
        totalBytes: model.bytes,
        error: error instanceof Error ? error.message : String(error),
      },
      db,
    );
    running.delete(modelId);
  });

  return { started: true };
}

function record(state: DownloadState, db?: Db) {
  try {
    writeDownload(state, db ?? createClient());
  } catch {
    // Losing a progress update is not worth failing a download over.
  }
}

async function run(modelId: string) {
  const model = findModel(modelId);
  if (!model) throw new Error("Unknown model.");

  const directory = modelsRoot();
  mkdirSync(directory, { recursive: true });

  const { createModelDownloader } = await import("node-llama-cpp");

  let lastWrite = 0;

  const downloader = await createModelDownloader({
    modelUri: model.uri,
    dirPath: directory,
    showCliProgress: false,
    onProgress({ downloadedSize, totalSize }) {
      const now = Date.now();
      if (now - lastWrite < PROGRESS_INTERVAL_MS) return;
      lastWrite = now;

      record({
        modelId,
        status: "downloading",
        downloadedBytes: downloadedSize,
        totalBytes: totalSize || model.bytes,
      });
    },
  });

  const path = await downloader.download();

  const db = createClient();
  writeSetting(SETTING.localModelId, modelId, db);
  writeSetting(SETTING.localModelPath, path, db);
  writeDownload(
    {
      modelId,
      status: "ready",
      downloadedBytes: model.bytes,
      totalBytes: model.bytes,
      path,
    },
    db,
  );

  running.delete(modelId);
}

/** Clears a failed download so the wizard can offer to try again. */
export function clearDownload(db?: Db) {
  const target = db ?? createClient();
  const state = readDownload(target);
  if (state) running.delete(state.modelId);
  writeDownload(null, target);
}
