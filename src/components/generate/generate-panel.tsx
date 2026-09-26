"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Copy, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { setIncludeApplication, setScopeMode } from "@/lib/actions";
import {
  IngestionOptions,
  type OptionsState,
} from "@/components/generate/ingestion-options";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ratioFor,
  type DensityMode,
  type MeasuredYield,
} from "@/lib/generate/density";
import {
  defaultChoices,
  selectedUnits,
  type SourceOption,
} from "@/lib/generate/selection";

type GenerateMode = "append" | "replace" | "separate";

export type GenerationJobView = {
  id: string;
  status: "running" | "done" | "failed";
  mode: string;
  examId: string;
  batchIndex: number;
  batchCount: number;
  cardsCreated: number;
  cardsRejected: number;
  error: string | null;
  summary: Summary | null;
  finishedAt: string | null;
};

type Summary = {
  mode: string;
  density?: string;
  detail?: string;
  unitsUsed?: number;
  durationMs?: number;
  failedBatches?: { batch: number; error: string }[];
  target?: GenerateMode;
  examId?: string;
  createdExam?: { id: string; title: string } | null;
  cleared?: { deleted: number; kept: number } | null;
  batchCount: number;
  cardsCreated: number;
  cardsRejected: number;
  /** Older runs stored a free-text list here; it is no longer shown. */
  uncoveredNotes?: string[];
  objectivesWithoutCards?: { label: string | null; text: string }[];
  objectivesTotal?: number;
  rejections: RejectionEntry[];
};

/** Current runs store the full view; older ones only reason and question. */
type RejectionEntry = {
  reason: string;
  question: string;
  answer?: string;
  excerpt?: string;
  where?: string | null;
  explanation?: string;
  detail?: string;
};

const REJECTION_HEADINGS: Record<string, string> = {
  excerpt_not_in_source: "Quote not found in your material",
  unknown_citation: "Cited a page it was not given",
  duplicate: "Already in your deck",
  empty_content: "Blank card",
};

export function GeneratePanel({
  examId,
  scopeMode,
  slideCount,
  existingCards,
  includeApplication,
  initialJob,
  sources,
  density,
  densityRatio,
  observedRatio,
  bulkModel = null,
  measured,
  isAdmin = false,
}: {
  examId: string;
  scopeMode: "files" | "objectives";
  slideCount: number;
  /** Answer-source files this deck can generate from, with their page spans. */
  sources: SourceOption[];
  /** How finely this deck was last set to cut its material. */
  density: DensityMode;
  densityRatio: number | null;
  /** Cards per unit this deck has actually produced, when it has any. */
  observedRatio: number | null;
  /** The model bulk generation runs on, for a calibrated estimate. */
  bulkModel?: string | null;
  /** This install's finished runs on that model, per density. */
  measured?: Partial<Record<DensityMode, MeasuredYield>>;
  /** An admin licence gets exact number inputs and a higher ceiling. */
  isAdmin?: boolean;
  /** A run already in flight, so the panel comes back mid-generation. */
  initialJob: GenerationJobView | null;
  /** PRD §9 higher-order questions, persisted on the exam. */
  includeApplication: boolean;
  /** Cards already in this deck; deciding what to do with them comes first. */
  existingCards: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<Summary | null>(
    initialJob?.status === "done" ? initialJob.summary : null,
  );
  const [asking, setAsking] = useState(false);
  const [job, setJob] = useState<GenerationJobView | null>(initialJob);

  const running = job?.status === "running";

  /**
   * Watch the run on the server rather than the request.
   *
   * Generation stores each batch as it finishes, so it keeps working whether
   * or not anyone is looking. Polling the job means the progress is real, and
   * leaving the page and coming back picks it up where it is.
   */
  useEffect(() => {
    if (!running) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const response = await fetch(`/api/exams/${examId}/generate`);
        const payload = await response.json();
        if (cancelled) return;

        const next: GenerationJobView | null = payload.job;
        setJob(next);

        if (next && next.status !== "running") {
          if (next.status === "done") {
            setSummary(next.summary);
            toast.success(`Finished — ${next.cardsCreated} card(s) created`);
          } else {
            toast.error(next.error ?? "Generation failed");
          }
          router.refresh();
        }
      } catch {
        // A dropped poll is not a failure; the next one will catch up.
      }
    };

    // Quick enough to see a twenty-second run move, not just finish.
    const timer = setInterval(() => void tick(), 700);
    void tick();

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, examId, router]);
  const [application, setApplication] = useState(includeApplication);
  const [options, setOptions] = useState<OptionsState>(() => ({
    density,
    ratio: densityRatio ?? ratioFor(density, densityRatio),
    choices: defaultChoices(sources),
  }));

  async function generate(mode: GenerateMode) {
    setBusy(true);
    setAsking(false);
    setSummary(null);

    try {
      const response = await fetch(`/api/exams/${examId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, ...selection() }),
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Generation failed");
        return;
      }

      setSummary(null);
      setJob({
        id: payload.jobId,
        status: "running",
        mode: payload.target,
        examId: payload.examId,
        batchIndex: 0,
        batchCount: 0,
        cardsCreated: 0,
        cardsRejected: 0,
        error: null,
        summary: null,
        finishedAt: null,
      });

      if (payload.createdExam) {
        toast.success(
          `Generating into "${payload.createdExam.title}" — it keeps going if you navigate away`,
        );
        router.push(`/exams/${payload.createdExam.id}`);
        return;
      }

      toast.success("Generating — this keeps running if you navigate away");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The options, in the shape the route takes.
   *
   * A file left whole sends no range at all, so "everything" stays the
   * absence of a filter rather than a range that happens to cover it.
   */
  function selection() {
    const ranges: Record<string, { from: number; to: number }> = {};
    const sourceFileIds: string[] = [];

    for (const source of sources) {
      const choice = options.choices[source.id];
      if (!choice?.included) continue;
      sourceFileIds.push(source.id);
      if (!choice.whole) ranges[source.id] = { from: choice.from, to: choice.to };
    }

    return {
      density: options.density,
      densityRatio: options.density === "custom" ? options.ratio : null,
      sourceFileIds,
      ranges,
    };
  }

  /** With an empty deck there is nothing to decide, so do not ask. */
  function start() {
    if (existingCards === 0) void generate("append");
    else setAsking(true);
  }

  const disabled = busy || pending || running || slideCount === 0;
  const chosenUnits = selectedUnits(sources, options.choices);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generate flashcards</CardTitle>
        <CardDescription>
          Every card is checked against its slide before being saved — a card
          whose excerpt is not in your material is discarded, not stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={scopeMode}
            disabled={disabled}
            onValueChange={(value) =>
              startTransition(async () => {
                await setScopeMode(examId, value as "files" | "objectives");
              })
            }
          >
            <SelectTrigger className="sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="files">Cover everything in files</SelectItem>
              <SelectItem value="objectives">Study-guide focus</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={start} disabled={disabled || chosenUnits === 0}>
            {busy || running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {running && job?.batchCount
              ? `Making cards… ${job.batchIndex} of ${job.batchCount}`
              : busy || running
                ? "Making cards…"
                : "Generate"}
          </Button>
        </div>

        {/* Right under the button, where the eye already is — below the
            options it was easy to miss a run that finishes in twenty seconds. */}
        {job?.status === "running" ? <JobProgress job={job} /> : null}

        <div className="flex items-start gap-2">
          <Checkbox
            id="application"
            checked={application}
            disabled={disabled}
            onCheckedChange={(value) => {
              const next = value === true;
              setApplication(next);
              startTransition(async () => {
                await setIncludeApplication(examId, next);
              });
            }}
          />
          <div className="space-y-0.5">
            <Label htmlFor="application" className="text-sm font-normal">
              Add “what if” questions
            </Label>
            <p className="text-muted-foreground text-xs">
              Adds perturbation (&quot;what if this step is blocked?&quot;),
              directional (&quot;what happens when Y rises?&quot;), and scenario
              cards on top of the factual ones. They still have to quote your
              material.
            </p>
          </div>
        </div>

        {slideCount === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add your slides first.
          </p>
        ) : (
          <>
            <IngestionOptions
              sources={sources}
              state={options}
              onChange={setOptions}
              disabled={disabled}
              observedRatio={observedRatio}
              model={bulkModel}
              measured={measured}
              isAdmin={isAdmin}
            />
            <p className="text-muted-foreground text-xs">
              {chosenUnits === 0
                ? "Nothing selected — choose at least one file or widen the range."
                : "This can take a minute. You can keep studying meanwhile."}
            </p>
          </>
        )}

        {job?.status === "failed" ? (
          <p className="text-destructive text-sm">{job.error}</p>
        ) : null}

        {summary?.cleared ? (
          <p className="text-muted-foreground text-xs">
            Replaced {summary.cleared.deleted} generated card(s)
            {summary.cleared.kept > 0
              ? `; kept ${summary.cleared.kept} you had edited`
              : ""}
            .
          </p>
        ) : null}

        {summary ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              <strong>{summary.cardsCreated}</strong> cards created across{" "}
              {summary.batchCount} batch(es)
              {summary.cardsRejected > 0
                ? `, ${summary.cardsRejected} rejected`
                : ""}
              {summary.durationMs ? ` in ${formatDuration(summary.durationMs)}` : ""}
              .
            </p>

            {summary.failedBatches?.length ? (
              <p className="text-destructive text-xs">
                {summary.failedBatches.length} batch(es) failed and were
                skipped; everything else was kept.{" "}
                {summary.failedBatches[0].error}
              </p>
            ) : null}

            {summary.objectivesWithoutCards?.length ? (
              <ObjectivesWithoutCards
                examId={summary.examId ?? examId}
                objectives={summary.objectivesWithoutCards}
                total={summary.objectivesTotal ?? 0}
              />
            ) : summary.objectivesTotal ? (
              <p className="text-muted-foreground text-xs">
                Every one of the {summary.objectivesTotal} study-guide
                objectives got at least one card.
              </p>
            ) : null}

            {summary.rejections.length > 0 ? (
              <Rejections
                rejections={summary.rejections}
                created={summary.cardsCreated}
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This deck already has cards</DialogTitle>
            <DialogDescription>
              {existingCards} card{existingCards === 1 ? "" : "s"} are already
              here. Generating again in a different mode would otherwise stack
              a second set on top of them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Choice
              icon={<RefreshCw className="size-4" />}
              title="Replace them"
              body="Delete the generated cards and build fresh. Cards you edited yourself are kept."
              onClick={() => void generate("replace")}
            />
            <Choice
              icon={<Copy className="size-4" />}
              title="Make a separate deck"
              body="Copy the sources into a second deck and generate there. This deck is left exactly as it is."
              onClick={() => void generate("separate")}
            />
            <Choice
              icon={<Layers className="size-4" />}
              title="Add to this deck"
              body="Keep both sets together. Identical questions are skipped, but two cards covering the same fact in different words will both stay."
              onClick={() => void generate("append")}
            />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Milliseconds are what the log wants; a student wants "1m 12s". */
function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * What generation is actually doing.
 *
 * Batches are counted as they finish, not as they start, so "3 of 12" means
 * three batches are safely stored. The card count rising as it goes is the
 * thing that used to look like cards appearing at random after the end.
 */
function JobProgress({ job }: { job: GenerationJobView }) {
  const percent = job.batchCount
    ? Math.min(100, (job.batchIndex / job.batchCount) * 100)
    : 8;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" />
          {job.batchCount
            ? `${job.batchIndex} of ${job.batchCount} batches done`
            : "Reading your material…"}
        </span>
        <span className="text-muted-foreground">
          {job.cardsCreated} card{job.cardsCreated === 1 ? "" : "s"} so far
          {job.cardsRejected > 0 ? ` · ${job.cardsRejected} rejected` : ""}
        </span>
      </div>

      <Progress value={percent} />

      <p className="text-muted-foreground text-xs">
        Cards are saved batch by batch, so they appear as they are checked. You
        can leave this page — generation carries on.
      </p>
    </div>
  );
}

function Choice({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/60 focus-visible:ring-ring w-full rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-muted-foreground mt-1 block text-xs">{body}</span>
    </button>
  );
}

function ObjectivesWithoutCards({
  examId,
  objectives,
  total,
}: {
  examId: string;
  objectives: { label: string | null; text: string }[];
  total: number;
}) {
  return (
    <div className="space-y-1">
      <p className="font-medium">
        {objectives.length} of {total} objectives got no card
      </p>
      <p className="text-muted-foreground text-xs">
        This does not mean your material skips them — only that no card was
        written for them this run. The{" "}
        <a href={`/exams/${examId}/coverage`} className="underline">
          coverage check
        </a>{" "}
        reads your slides to tell which are genuinely missing from your files.
      </p>
      <ul className="text-muted-foreground list-disc pl-5 text-xs">
        {objectives.map((objective, i) => (
          <li key={i}>
            {objective.label ? `${objective.label}. ` : ""}
            {objective.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The cards that were thrown away, and why, in the student's terms.
 *
 * Each one shows what the card said and one sentence of reason, so the check
 * reads as something working on their behalf rather than cards going missing.
 */
function Rejections({
  rejections,
  created,
}: {
  rejections: RejectionEntry[];
  created: number;
}) {
  const groups = new Map<string, RejectionEntry[]>();
  for (const rejection of rejections) {
    const list = groups.get(rejection.reason) ?? [];
    list.push(rejection);
    groups.set(rejection.reason, list);
  }

  return (
    <details>
      <summary className="cursor-pointer font-medium">
        {rejections.length} card{rejections.length === 1 ? "" : "s"} discarded
        by the source check
      </summary>
      <div className="mt-2 space-y-3">
        <p className="text-muted-foreground text-xs">
          Every card has to quote the page its answer came from, word for word.
          These did not, so they were not saved — the {created} you got all
          passed. Nothing here needs you to do anything.
        </p>

        {[...groups].map(([reason, list]) => (
          <div key={reason} className="space-y-1.5">
            <p className="text-xs font-medium">
              {REJECTION_HEADINGS[reason] ?? reason} ({list.length})
            </p>
            <ul className="space-y-2">
              {list.map((rejection, i) => (
                <li key={i} className="bg-muted/40 space-y-1 rounded p-2 text-xs">
                  <p className="font-medium">{rejection.question}</p>
                  {rejection.answer ? (
                    <p className="text-muted-foreground">A: {rejection.answer}</p>
                  ) : null}
                  {rejection.excerpt ? (
                    <blockquote className="text-muted-foreground border-l-2 pl-2 italic">
                      “{rejection.excerpt}”
                    </blockquote>
                  ) : null}
                  <p>{rejection.explanation ?? rejection.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
