"use client";

import { useState } from "react";
import { Loader2, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

export function PrimerSections({
  sections,
  slides,
}: {
  sections: PrimerSectionView[];
  slides: CitationSlides;
}) {
  return (
    <div className="space-y-6">
      {sections.map((section, i) => (
        <Card key={section.id} id={`concept-${i + 1}`}>
          <CardHeader>
            <CardTitle className="text-lg">
              <span className="text-muted-foreground mr-2 tabular-nums">{i + 1}.</span>
              {section.conceptName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Part title="Definition" sentences={section.definition} slides={slides} />
            <Part title="Breakdown" sentences={section.breakdown} slides={slides} />
            <Part title="Example" sentences={section.example} slides={slides} />
            <CounterExamplePanel sectionId={section.id} initial={section.counterExample} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function Part({
  title,
  sentences,
  slides,
}: {
  title: string;
  sentences: CitedSentence[];
  slides: CitationSlides;
}) {
  if (sentences.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
        {title}
      </h3>
      <CitedText sentences={sentences} slides={slides} />
    </section>
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
