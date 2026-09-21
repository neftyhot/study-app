"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { search } from "@/lib/search/match";

export type DeckCard = { id: string; haystack: string };

/**
 * Speed search inside one deck.
 *
 * Runs entirely in the browser over cards the page already has, so it is
 * instant in the way Cmd-F is instant: no request, no debounce worth noticing,
 * results as you type. Matching uses the same rules as the global search, so
 * the two cannot drift apart.
 */
export function DeckSearch({
  cards,
  onChange,
}: {
  cards: DeckCard[];
  /** Matching ids in rank order, or null when the box is empty. */
  onChange: (ids: string[] | null, query: string) => void;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return null;
    return search(cards, trimmed, { limit: cards.length });
  }, [cards, query]);

  useEffect(() => {
    onChange(matches ? matches.map((match) => match.item.id) : null, query);
    // `onChange` is a render-stable callback from the page above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, query]);

  // Cmd-F is the gesture people already have for this, and the browser's own
  // find cannot see cards that are collapsed or off screen.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        setQuery("");
        inputRef.current?.blur();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const exact = matches?.filter((match) => match.kind === "exact").length ?? 0;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find in this deck…"
          className="pr-9 pl-9"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
            aria-label="Clear"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>

      {matches ? (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          {matches.length} of {cards.length} cards
          {exact > 0 ? <Badge variant="outline">{exact} exact</Badge> : null}
          {matches.length === 0 ? (
            <span>
              Nothing here matches — try{" "}
              <a href={`/search?q=${encodeURIComponent(query)}`} className="underline">
                searching everything
              </a>
              .
            </span>
          ) : null}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Press <kbd>⌘F</kbd> to jump here. Quote a phrase for an exact match.
        </p>
      )}
    </div>
  );
}
