"use client";

import { useRef, useState } from "react";
import {
  Calculator,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  ListTree,
  Loader2,
  MessageCircleQuestion,
  ShieldQuestion,
} from "lucide-react";

import {
  CalculationsBox,
  CalculatorPanel,
  NumbersPanel,
  numberRows,
  type CalculatorHandle,
} from "@/components/cards/number-tools";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { Button } from "@/components/ui/button";
import type { PrimerFormat } from "@/db/schema";
import { cn } from "@/lib/utils";
import {
  exampleView,
  type CalculationStep,
  type CitedSentence,
  type CounterExample,
  type ExtraExample,
  type NumberGiven,
} from "@/lib/primer/types";

/** Matches MAX_EXTRA_EXAMPLES in lib/primer; that module is server-only. */
const MAX_EXTRA_EXAMPLES = 5;

import { CitedText, type CitationSlides } from "./cited-text";

export type PrimerSectionView = {
  id: string;
  conceptName: string;
  definition: CitedSentence[];
  breakdown: CitedSentence[];
  example: CitedSentence[];
  counterExample: CounterExample | null;
  /** Examples written on request, after the one the guide came with. */
  extraExamples: ExtraExample[];
  /** Every number the concept states, with what it is. */
  givens?: NumberGiven[];
  /** The working behind the example's numbers, step by step. */
  calculations?: CalculationStep[];
};

export type PrimerChapterView = {
  key: string;
  title: string;
  intro: string;
  sections: PrimerSectionView[];
};

/** What the breakdown is called in each format. */
export const BREAKDOWN_HEADING: Record<PrimerFormat, string> = {
  explained: "How it works",
  bullets: "Key facts",
  qa: "Test yourself",
  compare: "Don't confuse it with",
};

/**
 * The part of a concept that differs by format: prose, bullets, questions
 * with hidden answers, or contrasts.
 */
export function Breakdown({
  format,
  sentences,
  slides,
}: {
  format: PrimerFormat;
  sentences: CitedSentence[];
  slides: CitationSlides;
}) {
  if (sentences.length === 0) return null;
  let body: React.ReactNode;
  switch (format) {
    case "bullets":
      body = (
        <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
          {sentences.map((sentence, i) => (
            <li key={i}>
              <CitedText sentences={[sentence]} slides={slides} />
            </li>
          ))}
        </ul>
      );
      break;
    case "qa":
      body = (
        <div className="space-y-2">
          {sentences.map((sentence, i) => (
            <details key={i} className="group rounded-md border px-3 py-2">
              <summary className="flex cursor-pointer list-none items-start gap-2 font-medium">
                <ChevronRight className="text-muted-foreground mt-1 size-4 shrink-0 transition-transform group-open:rotate-90" />
                <span>
                  {sentence.label ?? `Question ${i + 1}`}
                  <span className="text-muted-foreground ml-2 text-xs font-normal group-open:hidden">
                    Check answer
                  </span>
                </span>
              </summary>
              <div className="mt-2 pl-6">
                <CitedText sentences={[sentence]} slides={slides} />
              </div>
            </details>
          ))}
        </div>
      );
      break;
    case "compare":
      body = (
        <dl className="space-y-2">
          {sentences.map((sentence, i) => (
            <div key={i} className="rounded-md border px-3 py-2">
              {sentence.label ? <dt className="font-semibold">{sentence.label}</dt> : null}
              <dd>
                <CitedText sentences={[sentence]} slides={slides} />
              </dd>
            </div>
          ))}
        </dl>
      );
      break;
    default:
      body = <CitedText sentences={sentences} slides={slides} />;
  }
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">{BREAKDOWN_HEADING[format]}</h4>
      {body}
    </div>
  );
}

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
  examId,
  chapters,
  slides,
  format = "explained",
}: {
  examId: string;
  chapters: PrimerChapterView[];
  slides: CitationSlides;
  format?: PrimerFormat;
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  // One calculator for the whole guide, so it stays put while scrolling.
  const [calcOpen, setCalcOpen] = useState(false);
  const calcRef = useRef<CalculatorHandle>(null);
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

      <div className="min-w-0 space-y-6" data-primer-document>
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
                      examId={examId}
                      chapterTitle={chapter.title}
                      anchor={conceptAnchor(i, j)}
                      number={`${i + 1}.${j + 1}`}
                      section={section}
                      slides={slides}
                      format={format}
                      calculatorOpen={calcOpen}
                      onToggleCalculator={() => setCalcOpen((value) => !value)}
                      onPickNumber={(value) => calcRef.current?.insert(value)}
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
      <CalculatorPanel ref={calcRef} open={calcOpen} onOpenChange={setCalcOpen} />
    </div>
  );
}

/** Block-level text the student can read; nested matches are skipped so nothing is said twice. */
const READABLE = "h1, h2, h3, h4, h5, p, li, dt, dd, summary";
const MAX_SCREEN_CHARS = 4_000;

/**
 * The words of the study guide that are on screen right now, top to bottom.
 * Goes with a question alongside the screenshot, and in place of it for a
 * model that can't see images.
 */
function visibleGuideText(): string {
  const root = document.querySelector("[data-primer-document]");
  if (!root) return "";
  const bottom = window.innerHeight;
  const lines: string[] = [];
  let length = 0;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(READABLE))) {
    if (element.parentElement?.closest(READABLE)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= bottom || rect.height === 0) continue;
    const text = element.innerText.replace(/\s+/g, " ").trim();
    if (!text) continue;
    lines.push(text);
    length += text.length + 1;
    if (length > MAX_SCREEN_CHARS) break;
  }
  return lines.join("\n").slice(0, MAX_SCREEN_CHARS);
}

async function post<T>(url: string, sectionId: string): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sectionId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

function Concept({
  examId,
  chapterTitle,
  anchor,
  number,
  section,
  slides,
  format,
  calculatorOpen,
  onToggleCalculator,
  onPickNumber,
}: {
  examId: string;
  chapterTitle: string;
  anchor: string;
  number: string;
  section: PrimerSectionView;
  slides: CitationSlides;
  format: PrimerFormat;
  calculatorOpen: boolean;
  onToggleCalculator: () => void;
  onPickNumber: (value: string) => void;
}) {
  const hasBuiltIn = section.example.length > 0;
  const calculations = section.calculations ?? [];
  // The concept's own list of numbers, or for an older guide, the numbers
  // found in its text; then each result the working reaches.
  const numbers = numberRows(
    section.givens ?? [],
    [...section.definition, ...section.breakdown, ...section.example]
      .map((sentence) => sentence.text)
      .join("\n"),
    calculations,
    true,
  );

  // More worked examples, one per press. Each is kept, so they are all there
  // on the next visit; the button goes once there are plenty.
  const [examples, setExamples] = useState<ExtraExample[]>(section.extraExamples);
  const [writingExample, setWritingExample] = useState(false);
  const [exampleError, setExampleError] = useState<string | null>(null);

  async function moreExamples() {
    setWritingExample(true);
    setExampleError(null);
    try {
      const body = await post<{ examples: ExtraExample[] }>("/api/primer/example", section.id);
      setExamples(body.examples);
    } catch (e) {
      setExampleError(e instanceof Error ? e.message : String(e));
    } finally {
      setWritingExample(false);
    }
  }

  // "What this isn't". Nothing is generated until the button is pressed; once
  // written, the server keeps it, so it is shown straight away next time.
  const [counter, setCounter] = useState<CounterExample | null>(section.counterExample);
  const [counterShown, setCounterShown] = useState(false);
  const [writingCounter, setWritingCounter] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);

  async function revealCounter() {
    setCounterShown(true);
    if (counter) return;
    setWritingCounter(true);
    setCounterError(null);
    try {
      const body = await post<{ counterExample: CounterExample }>(
        "/api/primer/counter-example",
        section.id,
      );
      setCounter(body.counterExample);
    } catch (e) {
      setCounterError(e instanceof Error ? e.message : String(e));
    } finally {
      setWritingCounter(false);
    }
  }

  const offset = hasBuiltIn ? 2 : 1;

  return (
    <article id={anchor} className="scroll-mt-6 space-y-3">
      <h3 className="text-lg font-semibold">
        <span className="text-muted-foreground mr-2 tabular-nums">{number}</span>
        {section.conceptName}
      </h3>
      <CitedText sentences={section.definition} slides={slides} />
      <Breakdown format={format} sentences={section.breakdown} slides={slides} />
      {hasBuiltIn ? (
        <div className={cn("bg-muted/40 space-y-1 rounded-md border-l-4 border-l-primary px-4 py-3")}>
          <h4 className="text-sm font-semibold">Example</h4>
          <CitedText sentences={section.example} slides={slides} />
        </div>
      ) : null}
      <CalculationsBox steps={calculations} />
      {numbers.length > 0 ? (
        <NumbersPanel
          rows={numbers}
          onPick={onPickNumber}
          actions={
            <Button
              variant={calculatorOpen ? "secondary" : "outline"}
              size="sm"
              aria-pressed={calculatorOpen}
              onClick={onToggleCalculator}
            >
              <Calculator className="size-4" />
              Calculator
            </Button>
          }
        />
      ) : null}

      <div className="space-y-3" aria-live="polite">
        {examples.map((example, index) => (
          <ExampleBox key={index} title={`Example ${index + offset}`} example={example} />
        ))}
        {exampleError ? <p className="text-destructive text-sm">{exampleError}</p> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {examples.length < MAX_EXTRA_EXAMPLES ? (
          <Button
            variant="outline"
            size="sm"
            disabled={writingExample}
            onClick={() => void moreExamples()}
          >
            {writingExample ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Lightbulb className="size-4" />
            )}
            {writingExample
              ? "Writing an example…"
              : hasBuiltIn || examples.length > 0
                ? "Another example"
                : "Show an example"}
          </Button>
        ) : null}
        {counterShown ? null : (
          <Button variant="outline" size="sm" onClick={() => void revealCounter()}>
            <ShieldQuestion className="size-4" />
            Show Counter-Example
          </Button>
        )}
        <TutorPanel
          examId={examId}
          primerSectionId={section.id}
          focus={`The student opened the tutor from their study guide, on concept ${number} "${section.conceptName}" in the topic "${chapterTitle}". That topic of the guide and the lecture slides it cites are at the top of the material.`}
          contextLabel="It has this topic of your study guide, the slides it cites, your deck and what is on your screen."
          captureScreen
          screenText={visibleGuideText}
          trigger={
            <Button variant="outline" size="sm">
              <MessageCircleQuestion className="size-4" />
              Ask a tutor
            </Button>
          }
        />
      </div>

      {counterShown ? (
        <CounterExamplePanel
          value={counter}
          loading={writingCounter}
          error={counterError}
          onRetry={() => void revealCounter()}
        />
      ) : null}
    </article>
  );
}

/**
 * One written example. When it has numbers, the working sits in a box down
 * the right-hand third with the text wrapping around it, so no value in the
 * example is one the student has to take on trust.
 */
function ExampleBox({ title, example }: { title: string; example: ExtraExample }) {
  const { text, calculations } = exampleView(example);
  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-md border-l-4 border-l-primary px-4 py-3 sm:block sm:flow-root">
      <CalculationsBox
        steps={calculations}
        className="order-last sm:float-right sm:mt-6 sm:mb-2 sm:ml-4 sm:w-1/3"
      />
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function CounterExamplePanel({
  value,
  loading,
  error,
  onRetry,
}: {
  value: CounterExample | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
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
          <Button variant="outline" size="sm" onClick={onRetry}>
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
