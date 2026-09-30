import Link from "next/link";
import { Layers } from "lucide-react";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangeFormatDialog } from "@/components/primer/change-format-dialog";
import { PrimerGenerator } from "@/components/primer/primer-generator";
import { PrimerDocument } from "@/components/primer/primer-sections";
import { WritePrimerButton } from "@/components/primer/write-primer-button";
import { db } from "@/db";
import { cn } from "@/lib/utils";
import {
  PRIMER_DEPTHS,
  PRIMER_FORMATS,
  getPrimer,
  isPrimerDepth,
  isPrimerFormat,
  loadPrimerSlides,
  primerGuidesWritten,
} from "@/lib/primer";
import { getExam } from "@/lib/queries";

export default async function PrimerPage(props: PageProps<"/exams/[examId]/primer">) {
  const { examId } = await props.params;
  const { depth: rawDepth, format: rawFormat } = await props.searchParams;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const written = primerGuidesWritten(db, examId);
  // With no choice in the address, open the first guide written, if any.
  const first = written[0];
  const depth = isPrimerDepth(rawDepth) ? rawDepth : (first?.depth ?? "balanced");
  const format = isPrimerFormat(rawFormat)
    ? rawFormat
    : isPrimerDepth(rawDepth)
      ? "explained"
      : (first?.format ?? "explained");
  const primer = getPrimer(db, examId, depth, format);
  const hasSlides = primer !== null || loadPrimerSlides(db, examId).length > 0;
  const depthLabel = (id: string) => PRIMER_DEPTHS.find((d) => d.id === id)?.label ?? id;
  const formatLabel = (id: string) => PRIMER_FORMATS.find((f) => f.id === id)?.label ?? id;
  const versionHref = (d: string, f: string) => `/exams/${examId}/primer?depth=${d}&format=${f}`;
  const writtenKeys = written.map((g) => `${g.depth}:${g.format}`);

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

      {written.length > 0 ? (
        <nav aria-label="Your study guides" className="flex flex-wrap gap-2">
          {written.map((g) => {
            const active = g.depth === depth && g.format === format;
            return (
              <Link
                key={`${g.depth}:${g.format}`}
                href={versionHref(g.depth, g.format)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent",
                )}
              >
                {depthLabel(g.depth)} · {formatLabel(g.format)}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {primer ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
            <p className="text-muted-foreground text-sm">
              {primer.chapters.length} topic{primer.chapters.length === 1 ? "" : "s"} ·{" "}
              {primer.sections.length} concepts · {depthLabel(depth)} · {formatLabel(format)}
            </p>
            <div className="flex flex-wrap items-start gap-2">
              <ChangeFormatDialog
                key={`${depth}:${format}`}
                examId={examId}
                depth={depth}
                format={format}
                written={writtenKeys}
              />
              <WritePrimerButton
                examId={examId}
                depth={depth}
                format={format}
                rewrite
                href={versionHref(depth, format)}
              />
            </div>
          </div>
          {primer.guide.overview ? (
            <section className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight">Overview</h2>
              <p className="leading-relaxed">{primer.guide.overview}</p>
            </section>
          ) : null}
          <PrimerDocument
            examId={examId}
            format={format}
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
                givens: s.givens ?? [],
                calculations: s.calculations ?? [],
              })),
            }))}
          />
        </>
      ) : null}

      {hasSlides ? (
        primer ? null : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {written.length > 0 ? "Write another version" : "Write your study guide"}
              </CardTitle>
              <CardDescription>
                Pick how you want it broken down and how long it should be. The preview shows
                what each choice looks like.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PrimerGenerator
                examId={examId}
                initialDepth={depth}
                initialFormat={format}
                written={writtenKeys}
              />
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-sm">
              Upload a slideshow first —{" "}
              <Link className="underline" href={`/exams/${examId}/sources`}>
                manage sources
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
