import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getExam, listFlashcards } from "@/lib/queries";

export default async function CardsPage(
  props: PageProps<"/exams/[examId]/cards">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const cards = await listFlashcards(examId);

  // Grouping by topic makes atomization visible: one concept, many facets.
  const byTopic = new Map<string, typeof cards>();
  for (const card of cards) {
    const key = card.topic ?? "Untitled";
    byTopic.set(key, [...(byTopic.get(key) ?? []), card]);
  }

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Flashcards
            <Badge variant="secondary" className="ml-2 align-middle">
              {cards.length}
            </Badge>
          </h1>
          {cards.length > 0 ? (
            <Button asChild size="sm">
              <Link href={`/exams/${examId}/study`}>Study these</Link>
            </Button>
          ) : null}
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No cards yet. Generate them from the exam overview.
        </p>
      ) : (
        <div className="space-y-8">
          {[...byTopic.entries()].map(([topic, topicCards]) => (
            <section key={topic} className="space-y-3">
              <h2 className="text-lg font-medium">
                {topic}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {topicCards.length} cards
                </span>
              </h2>

              <div className="space-y-3">
                {topicCards.map((card) => (
                  <Card key={card.id}>
                    <CardHeader>
                      <CardTitle className="text-base leading-snug break-words">
                        {card.question}
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
                      <p>{card.directAnswer}</p>

                      {card.fullExplanation ? (
                        <p className="text-muted-foreground">
                          {card.fullExplanation}
                        </p>
                      ) : null}

                      {card.rubric && card.rubric.essentialPoints.length > 0 ? (
                        <div>
                          <p className="text-xs font-medium">Must include</p>
                          <ul className="text-muted-foreground list-disc pl-5 text-xs">
                            {card.rubric.essentialPoints.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {card.sourceSlide ? (
                        <details className="bg-muted/50 rounded p-2">
                          <summary className="cursor-pointer text-xs font-medium">
                            Source:{" "}
                            {card.sourceSlide.sourceFile.fileType === "pptx"
                              ? "Slide"
                              : "Page"}{" "}
                            {card.sourceSlide.index} of{" "}
                            {card.sourceSlide.sourceFile.filename}
                          </summary>
                          {card.sourceExcerpt ? (
                            <blockquote className="text-muted-foreground mt-2 border-l-2 pl-2 text-xs italic">
                              {card.sourceExcerpt}
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
      )}
    </div>
  );
}
