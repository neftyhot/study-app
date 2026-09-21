"use client";

import { useCallback, useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { DeckSearch } from "@/components/search/deck-search";
import { Highlighted } from "@/components/search/highlighted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { enrichCardAction } from "@/lib/generate/actions";

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
}: {
  examId: string;
  cards: DeckCardView[];
}) {
  const [matches, setMatches] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");

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
              <Card key={card.id}>
                <CardHeader>
                  <CardTitle className="text-base leading-snug break-words">
                    <Highlighted text={card.question} query={query} />
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
  examId,
  card,
  query,
}: {
  examId: string;
  card: DeckCardView;
  query: string;
}) {
  const [text, setText] = useState(card.fullExplanation);
  const [busy, setBusy] = useState(false);

  if (text) {
    return (
      <p className="text-muted-foreground break-words">
        <Highlighted text={text} query={query} />
      </p>
    );
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await enrichCardAction(examId, card.id);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          setText(result.fullExplanation);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Sparkles className="size-3.5" />
      )}
      {busy ? "Working…" : "Explain in depth"}
    </Button>
  );
}
