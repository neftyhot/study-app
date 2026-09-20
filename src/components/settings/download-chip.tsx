"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { formatBytes, type LocalModel } from "@/lib/llm/catalog";
import type { DownloadState } from "@/lib/settings-shared";
import { downloadProgress } from "@/lib/settings-actions";

/**
 * The only thing a student sees while several gigabytes arrive.
 *
 * Deliberately small and out of the way: the download is meant to happen
 * behind them, not to be an event they have to attend.
 */
export function DownloadChip({
  initial,
  models,
}: {
  initial: DownloadState | null;
  models: LocalModel[];
}) {
  const [download, setDownload] = useState(initial);

  useEffect(() => {
    if (download?.status !== "downloading") return;

    const timer = setInterval(async () => {
      setDownload(await downloadProgress());
    }, 2000);

    return () => clearInterval(timer);
  }, [download?.status]);

  if (download?.status !== "downloading") return null;

  const name =
    models.find((model) => model.id === download.modelId)?.name ??
    download.modelId;
  const percent = download.totalBytes
    ? Math.round((download.downloadedBytes / download.totalBytes) * 100)
    : 0;

  return (
    <Link
      href="/settings"
      className="text-muted-foreground hover:text-foreground hidden items-center gap-1.5 text-xs sm:flex"
      title={`${name}: ${formatBytes(download.downloadedBytes)} of ${formatBytes(download.totalBytes)}`}
    >
      <Loader2 className="size-3 animate-spin" />
      {percent}%
    </Link>
  );
}
