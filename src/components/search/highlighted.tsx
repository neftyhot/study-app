"use client";

import { highlight } from "@/lib/search/match";

/** Shows text with the literal query marked, the way Cmd-F does. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((part, index) =>
        part.hit ? (
          <mark
            key={index}
            className="bg-primary/25 text-foreground rounded-[2px] px-0.5"
          >
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}
