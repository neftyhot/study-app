import { ChevronRight, FlaskConical, TriangleAlert } from "lucide-react";

export const EXPERIMENTAL_LOCAL_TITLE =
  "Experimental: Local Offline Models (Advanced)";

/**
 * Where the on-device models live: out of the way, and closed.
 *
 * They work, but on most laptops they are slow, heavy, and weaker than the
 * free cloud option — a student who picks one by accident gets worse cards
 * and a hot machine. So they sit behind a disclosure with the cost spelled
 * out, rather than as an equal first choice.
 *
 * A native <details>: keyboard and screen-reader behaviour for free, and it
 * stays open or closed across re-renders without any state here.
 */
export function ExperimentalLocalSection({
  defaultOpen = false,
  children,
}: {
  /** Open when the student is already using, or downloading, a local model. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border">
      <summary className="hover:bg-muted/60 flex cursor-pointer list-none items-center gap-2 rounded-lg p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        <FlaskConical className="size-4 shrink-0" />
        {EXPERIMENTAL_LOCAL_TITLE}
      </summary>
      <div className="space-y-4 border-t p-4">
        <ResourceWarning />
        {children}
      </div>
    </details>
  );
}

export function ResourceWarning() {
  return (
    <div
      role="note"
      className="flex gap-3 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-100"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">Resource Intensive</p>
        <p className="text-sm">
          Running models locally requires significant unified RAM, downloads
          large model files (2GB–5GB), and will cause high CPU/battery usage on
          most laptops. We recommend using Cloud (Gemini) for faster,
          higher-quality generation at zero cost.
        </p>
      </div>
    </div>
  );
}
