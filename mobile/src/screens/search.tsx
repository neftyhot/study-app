/** Search every card, in every deck; star from the results. */
import { Star } from "lucide-react";
import { useEffect, useState } from "react";

import { useApp } from "../context";
import { setStarred } from "../data/cards";
import { searchCards, type SearchHit } from "../data/search";
import { Empty, Notice, Screen } from "../components/ui";

import { errorText } from "./source";

export function SearchScreen() {
  const { db, navigate, changed, platform } = useApp();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An empty box shows nothing, whatever the last search found.
  const shown = query.trim() ? hits : null;

  useEffect(() => {
    if (!query.trim()) return;
    let live = true;
    const timer = setTimeout(() => {
      searchCards(db, query).then(
        (found) => live && (setHits(found), setError(null)),
        (cause) => live && setError(errorText(cause)),
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [db, query]);

  async function toggle(hit: SearchHit) {
    await setStarred(db, hit.cardId, !hit.starred);
    void platform.haptics.impact("tap");
    setHits((all) => all?.map((h) => (h.cardId === hit.cardId ? { ...h, starred: !h.starred } : h)) ?? null);
    changed();
  }

  return (
    <Screen title="Search" back={false}>
      <input
        className="input"
        type="search"
        inputMode="search"
        placeholder="Search cards"
        aria-label="Search cards"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoCorrect="off"
        autoCapitalize="off"
      />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {shown && shown.length === 0 ? <Empty title="No matches">Try fewer or different words.</Empty> : null}
      {shown && shown.length > 0 ? (
        <div className="list">
          {shown.map((hit) => (
            <div className="row" key={hit.cardId}>
              <button
                type="button"
                className="row-main"
                style={{ border: 0, background: "none", color: "inherit", textAlign: "left", padding: 0 }}
                onClick={() => navigate({ name: "deck", examId: hit.examId })}
              >
                <span className="row-title">{hit.question}</span>
                <span className="row-sub">{hit.answer}</span>
                <span className="row-sub">{hit.deck}</span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={hit.starred ? "Unstar" : "Star"}
                aria-pressed={hit.starred}
                onClick={() => toggle(hit)}
              >
                <Star aria-hidden fill={hit.starred ? "currentColor" : "none"} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Screen>
  );
}
