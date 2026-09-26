import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PrimerSections } from "@/components/primer/primer-sections";
import { WritePrimerButton } from "@/components/primer/write-primer-button";
import { db } from "@/db";
import { cn } from "@/lib/utils";
import {
  PRIMER_DEPTHS,
  getPrimer,
  isPrimerDepth,
  loadPrimerSlides,
  primerDepthsWritten,
} from "@/lib/primer";
import { getExam } from "@/lib/queries";

export default async function PrimerPage(props: PageProps<"/exams/[examId]/primer">) {
  const { examId } = await props.params;
  const { depth: rawDepth } = await props.searchParams;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const depth = isPrimerDepth(rawDepth) ? rawDepth : "balanced";
  const primer = getPrimer(db, examId, depth);
  const written = new Set(primerDepthsWritten(db, examId));
  const hasSlides = primer !== null || loadPrimerSlides(db, examId).length > 0;
  const current = PRIMER_DEPTHS.find((d) => d.id === depth)!;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <Link href={`/exams/${examId}`} className="text-muted-foreground text-sm hover:underline">
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Study Guide</h1>
        <p className="text-muted-foreground">
          Read this before the flashcards. Every sentence marked ⌄ opens the slide it came from.
        </p>
      </div>

      <nav aria-label="Depth" className="flex flex-wrap gap-2">
        {PRIMER_DEPTHS.map((option) => (
          <Link
            key={option.id}
            href={`/exams/${examId}/primer?depth=${option.id}`}
            aria-current={option.id === depth ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              option.id === depth
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent",
            )}
          >
            {option.label}
            {written.has(option.id) && option.id !== depth ? (
              <span className="text-muted-foreground ml-1.5 text-xs">✓</span>
            ) : null}
          </Link>
        ))}
      </nav>

      {primer ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {current.blurb}{" "}
              <Badge variant="secondary">{primer.sections.length} concepts</Badge>
            </p>
            <WritePrimerButton examId={examId} depth={depth} rewrite />
          </div>
          <PrimerSections
            slides={primer.slides}
            sections={primer.sections.map((s) => ({
              id: s.id,
              conceptName: s.conceptName,
              definition: s.definition,
              breakdown: s.breakdown,
              example: s.example,
              counterExample: s.counterExample ?? null,
            }))}
          />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No {current.label} primer yet</CardTitle>
            <CardDescription>{current.blurb}</CardDescription>
          </CardHeader>
          <CardContent>
            {hasSlides ? (
              <WritePrimerButton examId={examId} depth={depth} rewrite={false} />
            ) : (
              <p className="text-muted-foreground text-sm">
                Upload a slideshow first —{" "}
                <Link className="underline" href={`/exams/${examId}/sources`}>
                  manage sources
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
