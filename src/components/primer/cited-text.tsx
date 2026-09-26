"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { citationLabel } from "@/lib/order";
import type { CitedSentence } from "@/lib/primer/types";

/** Where a callout finds its slide picture; keyed by "doc:slide". */
export type CitationSlides = Record<string, { slideId: string; hasImage: boolean }>;

function slideFor(sentence: CitedSentence, slides: CitationSlides) {
  if (sentence.source_document_index === null || sentence.source_slide_number === null) {
    return undefined;
  }
  return slides[`${sentence.source_document_index}:${sentence.source_slide_number}`];
}

export function isCited(sentence: CitedSentence): boolean {
  return sentence.source_document_index !== null && sentence.source_slide_number !== null;
}

/**
 * A run of sentences, each cited one ending in a ⌄ that opens the slide it
 * came from underneath the paragraph.
 *
 * One callout is open at a time, so a paragraph never turns into a column of
 * quotes; `defaultOpen` exists for tests and deep links.
 */
export function CitedText({
  sentences,
  slides,
  defaultOpen = null,
}: {
  sentences: CitedSentence[];
  slides: CitationSlides;
  defaultOpen?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen);
  const baseId = useId();
  const current = open === null ? undefined : sentences[open];

  return (
    <div className="space-y-2">
      <p className="leading-relaxed">
        {sentences.map((sentence, i) => (
          <span key={i}>
            {sentence.text}
            {isCited(sentence) ? (
              <button
                type="button"
                aria-expanded={open === i}
                aria-controls={`${baseId}-callout`}
                aria-label={`Show source: ${citationLabel(sentence.source_document_index, sentence.source_slide_number)}`}
                title={citationLabel(sentence.source_document_index, sentence.source_slide_number)}
                onClick={() => setOpen(open === i ? null : i)}
                className={cn(
                  "text-primary hover:bg-accent ml-0.5 inline-flex size-5 translate-y-0.5 items-center justify-center rounded-sm align-baseline",
                  open === i && "bg-accent",
                )}
              >
                <ChevronDown className={cn("size-3.5 transition-transform", open === i && "rotate-180")} />
              </button>
            ) : null}{" "}
          </span>
        ))}
      </p>
      {current && isCited(current) ? (
        <CitationCallout
          id={`${baseId}-callout`}
          sentence={current}
          slide={slideFor(current, slides)}
        />
      ) : null}
    </div>
  );
}

/** The slide behind one sentence: where it is, what it says, and its picture. */
export function CitationCallout({
  id,
  sentence,
  slide,
}: {
  id?: string;
  sentence: CitedSentence;
  slide?: { slideId: string; hasImage: boolean };
}) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <aside
      id={id}
      role="note"
      className="border-primary bg-muted/50 space-y-2 rounded-md border-l-4 p-3 text-sm"
    >
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {citationLabel(sentence.source_document_index, sentence.source_slide_number)}
      </p>
      {sentence.source_excerpt ? (
        <blockquote className="italic">“{sentence.source_excerpt}”</blockquote>
      ) : (
        <p className="text-muted-foreground">No exact quote — this sentence summarises the slide.</p>
      )}
      {slide?.hasImage && !imageFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- served from the local store, not optimisable
        <img
          src={`/api/slides/${slide.slideId}/image`}
          alt={citationLabel(sentence.source_document_index, sentence.source_slide_number)}
          className="max-h-72 rounded border"
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : null}
    </aside>
  );
}
