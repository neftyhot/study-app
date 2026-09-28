import Link from "next/link";
import { Layers } from "lucide-react";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PrimerDocument } from "@/components/primer/primer-sections";
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
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <Link href={`/exams/${examId}`} className="text-muted-foreground text-sm hover:underline">
          ← {exam.title}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">Study Guide: {exam.title}</h1>
          <Button asChild variant="outline" size="sm">
            <Link href={`/exams/${examId}/study`}>
              <Layers className="size-4" />
              Flashcards
            </Link>
          </Button>
        </div>
        <p className="text-muted-foreground">
          Read it top to bottom: each topic builds on the ones before it. The ⌄ after a
          sentence opens the slide it came from.
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <p className="text-muted-foreground text-sm">
              {primer.chapters.length} topic{primer.chapters.length === 1 ? "" : "s"} ·{" "}
              {primer.sections.length} concepts · {current.label}: {current.blurb}
            </p>
            <WritePrimerButton examId={examId} depth={depth} rewrite />
          </div>
          {primer.guide.overview ? (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
              <p className="leading-relaxed">{primer.guide.overview}</p>
            </section>
          ) : null}
          <PrimerDocument
            slides={primer.slides}
            chapters={primer.chapters.map((chapter, i) => ({
              key: chapter.id ?? `loose-${i}`,
              title: chapter.title,
              intro: chapter.intro,
              sections: chapter.sections.map((s) => ({
                id: s.id,
                conceptName: s.conceptName,
                definition: s.definition,
                breakdown: s.breakdown,
                example: s.example,
                counterExample: s.counterExample ?? null,
                extraExamples: s.extraExamples ?? [],
              })),
            }))}
          />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No {current.label} study guide yet</CardTitle>
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
