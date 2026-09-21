import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CircleAlert,
  CircleCheck,
  CircleSlash,
  FileWarning,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConflictCard } from "@/components/coverage/conflict-card";
import { CoveragePanel } from "@/components/coverage/coverage-panel";
import {
  countReadyAnswerFiles,
  getCoverageFreshness,
  getCoverageMatrix,
  getExam,
  getExamStats,
  listConflicts,
  type CoverageRow,
} from "@/lib/queries";

export default async function CoveragePage(
  props: PageProps<"/exams/[examId]/coverage">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [rows, conflicts, stats, fileCount, freshness] = await Promise.all([
    getCoverageMatrix(examId),
    listConflicts(examId),
    getExamStats(examId),
    countReadyAnswerFiles(examId),
    getCoverageFreshness(examId),
  ]);

  const analyzed = rows.filter((row) => row.verdict);
  // Gaps the material cannot fill are a different problem from gaps the deck
  // missed, so they are listed separately rather than mixed into one count.
  const sourceGaps = analyzed.filter(
    (row) => row.verdict?.status !== "covered" && row.verdict?.sourceSupport === "silent",
  );
  const fixableGaps = analyzed.filter(
    (row) =>
      row.verdict?.status !== "covered" &&
      row.verdict?.sourceSupport !== "silent",
  );
  const openConflicts = conflicts.filter(
    (conflict) => !conflict.dismissed && !conflict.resolution,
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">
          Coverage matrix
        </h1>
        <p className="text-muted-foreground text-sm">
          Every study-guide objective, the cards that answer it, and the slides
          those cards came from.
        </p>
      </div>

      {freshness.stale ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TriangleAlert className="size-4" />
              This matrix is out of date
            </CardTitle>
            <CardDescription>
              It was built when the deck held {freshness.cardsThen} cards; there
              are {freshness.cardsNow} now. The verdicts below describe the
              older deck — run the analysis again before trusting them.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      <CoveragePanel
        examId={examId}
        objectiveCount={rows.length}
        cardCount={stats.flashcards}
        fileCount={fileCount}
      />

      {analyzed.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard
            label="Fully covered"
            value={analyzed.filter((r) => r.verdict?.status === "covered").length}
          />
          <StatCard
            label="Partial"
            value={
              analyzed.filter((r) => r.verdict?.status === "partially_covered")
                .length
            }
          />
          <StatCard
            label="Not covered"
            value={analyzed.filter((r) => r.verdict?.status === "missing").length}
          />
          <StatCard label="Conflicts open" value={openConflicts.length} />
        </div>
      ) : null}

      {sourceGaps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <FileWarning className="size-4" />
            Your files do not answer these
          </h2>
          <p className="text-muted-foreground text-sm">
            Generating more cards will not help. Find these in another source,
            or ask your professor.
          </p>
          <div className="space-y-3">
            {sourceGaps.map((row) => (
              <ObjectiveRow key={row.id} row={row} />
            ))}
          </div>
        </section>
      ) : null}

      {fixableGaps.length > 0 ? (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <CircleAlert className="size-4" />
            Covered by your slides, but not yet by your cards
          </h2>
          <div className="space-y-3">
            {fixableGaps.map((row) => (
              <ObjectiveRow key={row.id} row={row} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          All objectives
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {rows.length}
          </span>
        </h2>

        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No objectives yet. Upload a study guide from the sources page.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <ObjectiveRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </section>

      {conflicts.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">
            Contradictions across files
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {conflicts.length}
            </span>
          </h2>
          <p className="text-muted-foreground text-sm">
            Both sides are shown as written. Nothing here is resolved for you.
          </p>
          <div className="space-y-3">
            {conflicts.map((conflict) => (
              <ConflictCard
                key={conflict.id}
                conflict={{
                  id: conflict.id,
                  topic: conflict.topic,
                  statementA: conflict.statementA,
                  statementB: conflict.statementB,
                  explanation: conflict.explanation,
                  resolution: conflict.resolution,
                  dismissed: conflict.dismissed,
                  sourceA: unitLabel(conflict.slideA),
                  sourceB: unitLabel(conflict.slideB),
                }}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ObjectiveRow({ row }: { row: CoverageRow }) {
  const verdict = row.verdict;
  const cards = row.coverage.filter((mapping) => mapping.flashcard);
  const status = verdict?.status ?? null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug break-words">
            {row.label ? (
              <span className="text-muted-foreground mr-1.5">{row.label}.</span>
            ) : null}
            {row.promptText}
          </CardTitle>
          <StatusBadge status={status} />
        </div>
        <CardDescription>
          {status === null
            ? "Not analyzed yet"
            : cards.length > 0
              ? `Covered by ${cards.length} card${cards.length === 1 ? "" : "s"} via ${describeSources(cards)}`
              : "No cards map to this objective"}
        </CardDescription>
      </CardHeader>

      {verdict ? (
        <CardContent className="space-y-3 text-sm">
          {verdict.rationale ? (
            <p className="text-muted-foreground">{verdict.rationale}</p>
          ) : null}

          {verdict.missingPoints.length > 0 ? (
            <div>
              <p className="text-xs font-medium">Still missing</p>
              <ul className="text-muted-foreground list-disc pl-5 text-xs">
                {verdict.missingPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {verdict.sourceSupport ? (
            <div className="bg-muted/50 space-y-1 rounded p-2 text-xs">
              <p className="font-medium">
                {verdict.sourceSupport === "silent"
                  ? "Your uploaded material does not address this."
                  : verdict.sourceSupport === "partial"
                    ? "Your material partly answers this."
                    : "Your material does answer this — the cards just missed it."}
              </p>
              {verdict.supportingSlide ? (
                <p className="text-muted-foreground">
                  See {unitLabel(verdict.supportingSlide)}
                </p>
              ) : null}
              {verdict.supportingExcerpt ? (
                <blockquote className="text-muted-foreground border-l-2 pl-2 italic">
                  {verdict.supportingExcerpt}
                </blockquote>
              ) : null}
            </div>
          ) : null}

          {cards.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-xs font-medium">
                Cards ({cards.length})
              </summary>
              <ul className="mt-2 space-y-1.5">
                {cards.map((mapping) => (
                  <li key={mapping.id} className="text-muted-foreground text-xs">
                    <span className="text-foreground">
                      {mapping.flashcard?.question}
                    </span>
                    {mapping.status === "partially_covered" ? " (partial)" : null}
                    {mapping.flashcard?.sourceSlide
                      ? ` — ${unitLabel(mapping.flashcard.sourceSlide)}`
                      : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  if (status === "covered") {
    return (
      <Badge variant="secondary" className="gap-1">
        <CircleCheck className="size-3" />
        Covered
      </Badge>
    );
  }
  if (status === "partially_covered") {
    return (
      <Badge variant="outline" className="gap-1">
        <CircleAlert className="size-3" />
        Partial
      </Badge>
    );
  }
  if (status === "missing") {
    return (
      <Badge variant="destructive" className="gap-1">
        <CircleSlash className="size-3" />
        Not covered
      </Badge>
    );
  }
  return <Badge variant="outline">Not analyzed</Badge>;
}

type Unit = {
  index: number;
  sourceFile: { filename: string; fileType: string };
};

function unitLabel(unit: Unit | null): string {
  if (!unit) return "an unknown source";
  const noun = unit.sourceFile.fileType === "pptx" ? "slide" : "page";
  return `${noun} ${unit.index} of ${unit.sourceFile.filename}`;
}

/**
 * "Slides 15–19 of lecture2.pptx" — the shape PRD §3 asks the matrix to show.
 * Ranges are per file, because slide 3 of two decks is two different slides.
 */
function describeSources(mappings: CoverageRow["coverage"]): string {
  const byFile = new Map<
    string,
    { filename: string; fileType: string; indexes: number[] }
  >();

  for (const mapping of mappings) {
    const slide = mapping.flashcard?.sourceSlide;
    if (!slide) continue;

    const entry = byFile.get(slide.sourceFileId) ?? {
      filename: slide.sourceFile.filename,
      fileType: slide.sourceFile.fileType,
      indexes: [],
    };
    entry.indexes.push(slide.index);
    byFile.set(slide.sourceFileId, entry);
  }

  if (byFile.size === 0) return "cards with no cited slide";

  return [...byFile.values()]
    .map(({ filename, fileType, indexes }) => {
      const min = Math.min(...indexes);
      const max = Math.max(...indexes);
      const plural = fileType === "pptx" ? "Slides" : "Pages";
      const singular = fileType === "pptx" ? "Slide" : "Page";
      const range = min === max ? `${singular} ${min}` : `${plural} ${min}–${max}`;
      return `${range} of ${filename}`;
    })
    .join("; ");
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
