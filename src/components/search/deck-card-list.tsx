"use client";

import { useCallback, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { BulkBar, type DeckTarget } from "@/components/cards/bulk-bar";
import { DeckSearch } from "@/components/search/deck-search";
import { Highlighted } from "@/components/search/highlighted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { clozeRevealed } from "@/lib/cards/cloze";
import {
  ExplainButton,
  MisconceptionList,
} from "@/components/cards/explain-button";

export type DeckCardView = {
  id: string;
  topic: string;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  hasAiSupplement: boolean;
  isUserEdited: boolean;
  essentialPoints: string[];
  source: { label: string; excerpt: string | null } | null;
  /** Everything this card can be found by, including its source excerpt. */
  haystack: string;
};

/**
 * The deck's cards, with search over them.
 *
 * Grouping by topic makes atomization visible — one concept, many facets — so
 * the grouping survives filtering: a search narrows what is shown without
 * flattening the structure that explains why there are so many cards.
 */
export function DeckCardList({
  examId,
  cards,
  decks = [],
}: {
  examId: string;
  cards: DeckCardView[];
  /** Other decks, for moving and copying a selection. */
  decks?: DeckTarget[];
}) {
  const [matches, setMatches] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onChange = useCallback((ids: string[] | null, value: string) => {
    setMatches(ids);
    setQuery(value);
  }, []);

  const searchable = useMemo(
    () => cards.map((card) => ({ id: card.id, haystack: card.haystack })),
    [cards],
  );

  const visible = useMemo(() => {
    if (!matches) return cards;
    const order = new Map(matches.map((id, index) => [id, index]));
    return cards
      .filter((card) => order.has(card.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [cards, matches]);

  const byTopic = useMemo(() => {
    const groups = new Map<string, DeckCardView[]>();
    for (const card of visible) {
      groups.set(card.topic, [...(groups.get(card.topic) ?? []), card]);
    }
    return [...groups.entries()];
  }, [visible]);

  return (
    <div className="space-y-6">
      <DeckSearch cards={searchable} onChange={onChange} />

      {selected.size > 0 ? (
        <BulkBar
          examId={examId}
          selected={[...selected]}
          decks={decks}
          onDone={() => setSelected(new Set())}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setSelected(new Set(visible.map((card) => card.id)))}
          >
            Select all {visible.length === cards.length ? "" : "shown "}(
            {visible.length})
          </Button>
        </div>
      )}

      {byTopic.map(([topic, topicCards]) => (
        <section key={topic} className="space-y-3">
          <h2 className="text-lg font-medium">
            {topic}
            <span className="text-muted-foreground ml-2 text-sm font-normal">
              {topicCards.length} card{topicCards.length === 1 ? "" : "s"}
            </span>
          </h2>

          <div className="space-y-3">
            {topicCards.map((card) => (
              <Card
                key={card.id}
                className={selected.has(card.id) ? "border-primary" : undefined}
              >
                <CardHeader>
                  <CardTitle className="flex items-start gap-2 text-base leading-snug break-words">
                    <Checkbox
                      checked={selected.has(card.id)}
                      onCheckedChange={() => toggle(card.id)}
                      aria-label={`Select "${card.question.slice(0, 40)}"`}
                      className="mt-1 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      {card.cardType === "cloze" ? (
                        // Shown whole here: the browser is for reading the
                        // deck, not for being tested by it.
                        <Highlighted
                          text={clozeRevealed(card.question)}
                          query={query}
                        />
                      ) : (
                        <Highlighted text={card.question} query={query} />
                      )}
                    </span>
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge variant="outline">{card.cardType}</Badge>
                    {card.hasAiSupplement ? (
                      <Badge variant="outline" className="gap-1">
                        <Sparkles className="size-3" />
                        AI context added
                      </Badge>
                    ) : null}
                    {card.isUserEdited ? (
                      <Badge variant="outline">edited</Badge>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 text-sm">
                  <p className="break-words">
                    <Highlighted text={card.directAnswer} query={query} />
                  </p>

                  <Explanation
                    examId={examId}
                    card={card}
                    query={query}
                  />

                  {card.essentialPoints.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium">Must include</p>
                      <ul className="text-muted-foreground list-disc pl-5 text-xs">
                        {card.essentialPoints.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {card.source ? (
                    <details className="bg-muted/50 rounded p-2">
                      <summary className="cursor-pointer text-xs font-medium">
                        Source: {card.source.label}
                      </summary>
                      {card.source.excerpt ? (
                        <blockquote className="text-muted-foreground mt-2 border-l-2 pl-2 text-xs italic break-words">
                          <Highlighted text={card.source.excerpt} query={query} />
                        </blockquote>
                      ) : null}
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The explanation, or the offer to write one.
 *
 * Bulk generation stops at the answer, so most cards arrive without this. The
 * button is the "in-depth breakdown" that fills it in — for this card, because
 * it was asked for, rather than for the whole deck on the off chance.
 */
function Explanation({
  card,
  query,
}: {
  examId: string;
  card: DeckCardView;
  query: string;
}) {
  const [text, setText] = useState(card.fullExplanation);
  const [misconceptions, setMisconceptions] = useState<string[]>([]);

  if (text) {
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground break-words whitespace-pre-line">
          <Highlighted text={text} query={query} />
        </p>
        <MisconceptionList items={misconceptions} />
      </div>
    );
  }

  return (
    <ExplainButton
      cardId={card.id}
      onExplained={(result) => {
        setText(result.fullExplanation);
        setMisconceptions(result.commonMisconceptions);
      }}
    />
  );
}
