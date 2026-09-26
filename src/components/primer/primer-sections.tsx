"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ListTree, Loader2, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CitedSentence, CounterExample } from "@/lib/primer/types";

import { CitedText, type CitationSlides } from "./cited-text";

export type PrimerSectionView = {
  id: string;
  conceptName: string;
  definition: CitedSentence[];
  breakdown: CitedSentence[];
  example: CitedSentence[];
  counterExample: CounterExample | null;
};

export type PrimerChapterView = {
  key: string;
  title: string;
  intro: string;
  sections: PrimerSectionView[];
};

const chapterAnchor = (i: number) => `topic-${i + 1}`;
const conceptAnchor = (i: number, j: number) => `concept-${i + 1}-${j + 1}`;

/**
 * The study guide as a document: contents, then numbered chapters that build
 * on each other, each concept a sub-heading with prose under it.
 *
 * Only the first chapter starts open, so a long lecture reads as an outline
 * first and a wall of text never; the contents opens whichever is clicked.
 */
export function PrimerDocument({
  chapters,
  slides,
}: {
  chapters: PrimerChapterView[];
  slides: CitationSlides;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const allOpen = open.size === chapters.length;

  function toggle(i: number) {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function go(anchor: string, chapter: number) {
    setOpen((previous) => new Set(previous).add(chapter));
    // Wait a frame so a chapter that was closed has laid out its concepts.
    requestAnimationFrame(() =>
      document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }

  const contents = (
    <ol className="space-y-2 text-sm">
      {chapters.map((chapter, i) => (
        <li key={chapter.key}>
          <a
            href={`#${chapterAnchor(i)}`}
            onClick={(event) => {
              event.preventDefault();
              go(chapterAnchor(i), i);
            }}
            className="hover:text-primary font-medium"
          >
            {i + 1}. {chapter.title}
          </a>
          <ol className="text-muted-foreground mt-1 space-y-0.5 border-l pl-3">
            {chapter.sections.map((section, j) => (
              <li key={section.id}>
                <a
                  href={`#${conceptAnchor(i, j)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    go(conceptAnchor(i, j), i);
                  }}
                  className="hover:text-foreground"
                >
                  {i + 1}.{j + 1} {section.conceptName}
                </a>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
      <aside className="hidden lg:block">
        <nav
          aria-label="Contents"
          className="sticky top-6 max-h-[calc(100vh-3rem)] space-y-3 overflow-y-auto pr-2"
        >
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Contents
          </p>
          {contents}
        </nav>
      </aside>

      <div className="min-w-0 space-y-6">
        <details className="rounded-md border p-3 lg:hidden">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <ListTree className="size-4" /> Contents
          </summary>
          <nav aria-label="Contents" className="mt-3">
            {contents}
          </nav>
        </details>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(allOpen ? new Set() : new Set(chapters.map((_, i) => i)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>

        {chapters.map((chapter, i) => {
          const isOpen = open.has(i);
          return (
            <section key={chapter.key} id={chapterAnchor(i)} className="scroll-mt-6 border-t pt-6">
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                className="group flex w-full items-start gap-2 text-left"
              >
                {isOpen ? (
                  <ChevronDown className="text-muted-foreground mt-1.5 size-5 shrink-0" />
                ) : (
                  <ChevronRight className="text-muted-foreground mt-1.5 size-5 shrink-0" />
                )}
                <h2 className="text-xl font-semibold tracking-tight group-hover:underline">
                  <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
                  {chapter.title}
                </h2>
              </button>
              {chapter.intro ? (
                <p className="text-muted-foreground mt-2 pl-7 leading-relaxed">{chapter.intro}</p>
              ) : null}

              {isOpen ? (
                <div className="mt-6 space-y-10 pl-7">
                  {chapter.sections.map((section, j) => (
                    <Concept
                      key={section.id}
                      anchor={conceptAnchor(i, j)}
                      number={`${i + 1}.${j + 1}`}
                      section={section}
                      slides={slides}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground mt-2 pl-7 text-sm">
                  {chapter.sections.length} concept{chapter.sections.length === 1 ? "" : "s"}:{" "}
                  {chapter.sections.map((s) => s.conceptName).join(" · ")}
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Concept({
  anchor,
  number,
  section,
  slides,
}: {
  anchor: string;
  number: string;
  section: PrimerSectionView;
  slides: CitationSlides;
}) {
  return (
    <article id={anchor} className="scroll-mt-6 space-y-3">
      <h3 className="text-lg font-semibold">
        <span className="text-muted-foreground mr-2 tabular-nums">{number}</span>
        {section.conceptName}
      </h3>
      <CitedText sentences={section.definition} slides={slides} />
      {section.breakdown.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">How it works</h4>
          <CitedText sentences={section.breakdown} slides={slides} />
        </div>
      ) : null}
      {section.example.length > 0 ? (
        <div className={cn("bg-muted/40 space-y-1 rounded-md border-l-4 border-l-primary px-4 py-3")}>
          <h4 className="text-sm font-semibold">Example</h4>
          <CitedText sentences={section.example} slides={slides} />
        </div>
      ) : null}
      <CounterExamplePanel sectionId={section.id} initial={section.counterExample} />
    </article>
  );
}

/**
 * "What this isn't". Nothing is generated until the button is pressed; once
 * written, the server keeps it, so it is shown straight away on the next visit.
 */
function CounterExamplePanel({
  sectionId,
  initial,
}: {
  sectionId: string;
  initial: CounterExample | null;
}) {
  const [value, setValue] = useState<CounterExample | null>(initial);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setShown(true);
    if (value) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/primer/counter-example", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setValue(body.counterExample);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!shown) {
    return (
      <Button variant="outline" size="sm" onClick={reveal}>
        <ShieldQuestion className="size-4" />
        Show Counter-Example
      </Button>
    );
  }

  return (
    <div className="bg-muted/40 space-y-3 rounded-md border p-4 text-sm" aria-live="polite">
      <h3 className="font-semibold">What this isn&apos;t</h3>
      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Writing a counter-example…
        </p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={reveal}>
            Try again
          </Button>
        </div>
      ) : value ? (
        <dl className="space-y-3">
          <div>
            <dt className="font-medium">Common misconception</dt>
            <dd>{value.misconception}</dd>
          </div>
          <div>
            <dt className="font-medium">Incorrect application</dt>
            <dd>{value.incorrectApplication}</dd>
          </div>
          <div>
            <dt className="font-medium">Why it&apos;s flawed</dt>
            <dd>{value.whyFlawed}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
