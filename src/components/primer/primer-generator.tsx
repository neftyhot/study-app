"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { PrimerDepth, PrimerFormat } from "@/db/schema";
import { PRIMER_DEPTHS, PRIMER_FORMATS, TOPIC_CAP } from "@/lib/primer/formats";
import type { CitedSentence } from "@/lib/primer/types";
import { cn } from "@/lib/utils";

import { Breakdown } from "./primer-sections";
import { WritePrimerButton } from "./write-primer-button";

/**
 * Choosing how a study guide is written: format and depth, with a preview of
 * what that choice looks like on a made-up topic, then the button to write it.
 */
export function PrimerGenerator({
  examId,
  initialDepth = "balanced",
  initialFormat = "explained",
  written,
}: {
  examId: string;
  initialDepth?: PrimerDepth;
  initialFormat?: PrimerFormat;
  /** "depth:format" pairs already written, marked so they are not redone by accident. */
  written: string[];
}) {
  const [format, setFormat] = useState<PrimerFormat>(initialFormat);
  const [depth, setDepth] = useState<PrimerDepth>(initialDepth);
  const [withExamples, setWithExamples] = useState(true);
  const done = new Set(written);
  const exists = done.has(`${depth}:${format}`);

  return (
    <div className="space-y-5">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Format</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRIMER_FORMATS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === format}
              onClick={() => setFormat(option.id)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                option.id === format ? "border-primary bg-primary/5 ring-primary ring-1" : "hover:bg-accent",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">{option.blurb}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Length</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PRIMER_DEPTHS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === depth}
              onClick={() => setDepth(option.id)}
              className={cn(
                "rounded-md border p-3 text-left transition-colors",
                option.id === depth ? "border-primary bg-primary/5 ring-primary ring-1" : "hover:bg-accent",
              )}
            >
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="text-muted-foreground mt-0.5 block text-xs">
                Up to {TOPIC_CAP[option.id]} points per topic
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <FormatPreview format={format} depth={depth} withExamples={withExamples} />

      <div className="space-y-2">
        {exists ? (
          <p className="text-muted-foreground text-xs">
            You already have this version; writing it again replaces it.
          </p>
        ) : null}
        <WritePrimerButton
          key={`${depth}:${format}`}
          examId={examId}
          depth={depth}
          format={format}
          rewrite={exists}
          href={`/exams/${examId}/primer?depth=${depth}&format=${format}`}
          withExamples={withExamples}
          onWithExamplesChange={setWithExamples}
        />
      </div>
    </div>
  );
}

const plain = (text: string, label?: string): CitedSentence => ({
  text,
  source_document_index: null,
  source_slide_number: null,
  source_excerpt: null,
  ...(label ? { label } : {}),
});

/** The sample topic's concepts, in order; each depth shows as many as it allows. */
const SAMPLE_CONCEPTS = [
  "Law of demand",
  "Law of supply",
  "Equilibrium price",
  "Shortage",
  "Surplus",
  "Price elasticity of demand",
  "Shifts vs. movements",
  "Substitutes",
  "Complements",
  "Normal and inferior goods",
  "Price ceiling",
  "Price floor",
  "Consumer surplus",
  "Producer surplus",
  "Deadweight loss",
  "Income elasticity",
  "Cross-price elasticity",
  "Elastic vs. inelastic",
  "Total revenue test",
  "Tax incidence",
  "Subsidies",
  "Market demand curve",
  "Supply shifters",
  "Expectations",
  "Market efficiency",
];

const DEFINITION: Record<PrimerDepth, { long: string; short: string }> = {
  summary: {
    long: "When the price of something goes up, people buy less of it.",
    short: "Price up, quantity bought down.",
  },
  balanced: {
    long: "The law of demand says that when a price rises, people buy less of it, and when it falls they buy more, as long as nothing else changes.",
    short: "When price rises, the quantity people buy falls, if nothing else changes.",
  },
  foundational: {
    long: "Demand is how much of something people want to buy at each price. The law of demand says: the higher the price, the less of it they buy, as long as nothing else changes.",
    short: "Demand is how much people want to buy at each price; the higher the price, the less they buy.",
  },
};

/** Breakdown items per format, longest first; each depth takes as many as its range allows. */
const SAMPLE: Record<PrimerFormat, { counts: Record<PrimerDepth, number>; items: CitedSentence[] }> = {
  explained: {
    counts: { summary: 1, balanced: 3, foundational: 6 },
    items: [
      plain("A higher price takes more of a buyer's budget, so some buyers drop out."),
      plain("Buyers also switch to substitutes, like iced tea, when lemonade costs more."),
      plain("Only a change in price moves you along the demand curve; anything else shifts the whole curve."),
      plain("Think of your own pocket money: at $5 a cup you might skip it; at $1 you might buy two."),
      plain("A \"demand curve\" is just a graph with price up the side and cups bought along the bottom. It slopes down."),
      plain("\"Nothing else changes\" means we pretend incomes, weather and tastes stay put while only the price moves."),
    ],
  },
  bullets: {
    counts: { summary: 3, balanced: 6, foundational: 10 },
    items: [
      plain("Price up → quantity demanded down."),
      plain("Price down → quantity demanded up."),
      plain("Only holds if nothing else changes."),
      plain("Drawn as a downward-sloping demand curve."),
      plain("A price change moves along the curve; it does not shift it."),
      plain("Caused by limited budgets and available substitutes."),
      plain("Demand curve: price on the vertical axis, quantity on the horizontal."),
      plain("Substitute: something you could buy instead, like iced tea."),
      plain("\"Ceteris paribus\" means everything else held constant."),
      plain("Rare exceptions: status goods bought because they are expensive."),
    ],
  },
  qa: {
    counts: { summary: 2, balanced: 4, foundational: 8 },
    items: [
      plain("It falls.", "What happens to the quantity people buy when the price rises?"),
      plain("No. A price change moves you along the curve.", "Does a change in price shift the demand curve?"),
      plain(
        "The law of demand: $1 more per cup, 15 fewer cups (40 → 25).",
        "A lemonade stand raises its price from $2 to $3 and sales drop from 40 cups to 25. What is this an example of?",
      ),
      plain(
        "Each cup takes more of their budget, and substitutes look cheaper by comparison.",
        "Why do buyers buy less at a higher price?",
      ),
      plain("A graph of how many cups people would buy at each price.", "What is a demand curve?"),
      plain("Income, weather, tastes and other prices all stay the same.", "What does \"nothing else changes\" mean here?"),
      plain("Something bought instead, like iced tea instead of lemonade.", "What is a substitute?"),
      plain(
        "No. The price didn't change, so the whole curve shifted right.",
        "On a hot day, sales rise from 40 to 60 cups at the same $2. Is that the law of demand?",
      ),
    ],
  },
  compare: {
    counts: { summary: 1, balanced: 3, foundational: 5 },
    items: [
      plain("Demand is about buyers: price up, they buy less. Supply is about sellers: price up, they make more.", "vs. Law of supply"),
      plain("A price change moves along the curve; a hot day or a pay rise moves the whole curve.", "vs. A shift in demand"),
      plain("\"Quantity demanded\" is one point on the curve; \"demand\" is the whole curve.", "vs. Demand"),
      plain("The law says which direction sales move; elasticity says by how much.", "vs. Elasticity"),
      plain("Demand only counts wanting something with the money to pay for it.", "vs. Simply wanting it"),
    ],
  },
};

const SAMPLE_EXAMPLE = [
  plain(
    "At $2 a cup, a lemonade stand sells 40 cups on Saturday ($80). At $3 it sells 25 cups ($75): raising the price by $1 cost it 15 cups.",
  ),
];

function FormatPreview({
  format,
  depth,
  withExamples,
}: {
  format: PrimerFormat;
  depth: PrimerDepth;
  withExamples: boolean;
}) {
  const cap = TOPIC_CAP[depth];
  const sample = SAMPLE[format];
  const definition = format === "explained" ? DEFINITION[depth].long : DEFINITION[depth].short;
  const breakdown = sample.items.slice(0, sample.counts[depth]);
  const concepts = SAMPLE_CONCEPTS.slice(0, cap);

  return (
    <section
      aria-label="Example preview"
      className="bg-muted/30 space-y-4 rounded-lg border border-dashed p-4"
    >
      <div className="space-y-1">
        <Badge variant="outline" className="gap-1">
          <Eye className="size-3" /> Example preview
        </Badge>
        <p className="text-muted-foreground text-xs">
          A made-up sample topic (Economics: supply &amp; demand), <strong>not your slides</strong>.
          It only shows how this format and length look; your guide is written from your own
          material.
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">
          <span className="text-muted-foreground mr-2">1.</span>Supply &amp; demand
          <span className="text-muted-foreground ml-2 text-xs font-normal">
            {concepts.length} points in this topic
          </span>
        </h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {concepts.map((name, i) => `1.${i + 1} ${name}`).join(" · ")}
        </p>
      </div>

      <article className="bg-background space-y-3 rounded-md border p-4">
        <h4 className="font-semibold">
          <span className="text-muted-foreground mr-2 tabular-nums">1.1</span>Law of demand
        </h4>
        <p className="leading-relaxed">{definition}</p>
        <Breakdown format={format} sentences={breakdown} slides={{}} />
        {withExamples ? (
          <div className="bg-muted/40 space-y-1 rounded-md border-l-4 border-l-primary px-4 py-3">
            <h4 className="text-sm font-semibold">Example</h4>
            <p className="leading-relaxed">{SAMPLE_EXAMPLE[0].text}</p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            No example written up front; a “Show an example” button sits here instead.
          </p>
        )}
      </article>
    </section>
  );
}
