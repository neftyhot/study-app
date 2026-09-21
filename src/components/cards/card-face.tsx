"use client";

/**
 * The front and back of a card, wherever it is shown.
 *
 * Two things live here rather than in each study mode: a cloze card is blanked
 * until it is revealed, and an attached image is shown on the side it was
 * attached to. Both would otherwise have to be remembered in flashcard mode,
 * learn mode and the browser separately, and forgotten in one of them.
 */
import { parseCloze } from "@/lib/cards/cloze";

export type CardFaceData = {
  id: string;
  cardType: string;
  question: string;
  frontImage?: boolean;
  backImage?: boolean;
};

/** The question, with cloze deletions hidden until the answer is shown. */
export function CardQuestion({
  card,
  revealed = false,
  className = "text-lg leading-snug font-medium break-words",
}: {
  card: CardFaceData;
  revealed?: boolean;
  className?: string;
}) {
  if (card.cardType !== "cloze") {
    return <p className={className}>{card.question}</p>;
  }

  return (
    <p className={className}>
      {parseCloze(card.question).map((span, i) =>
        span.hidden ? (
          <span
            key={i}
            className={
              revealed
                ? "bg-primary/15 rounded px-1 font-semibold"
                : "bg-muted text-muted-foreground rounded px-2 select-none"
            }
          >
            {/* A fixed-width blank: a gap the length of the word would hand
                over its letter count for free. */}
            {revealed ? span.text : "?????"}
          </span>
        ) : (
          <span key={i}>{span.text}</span>
        ),
      )}
    </p>
  );
}

export function CardImage({
  cardId,
  side,
  alt = "",
}: {
  cardId: string;
  side: "front" | "back";
  alt?: string;
}) {
  return (
    // Served through the card, so a URL cannot be pointed at an arbitrary
    // file under the uploads root.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/cards/${cardId}/image?side=${side}`}
      alt={alt}
      className="max-h-64 rounded-md border"
    />
  );
}
