/** The cards behind a study session: one deck, everything due, or the starred ones. */
import { useEffect, useRef } from "react";

import type { SqlDriver } from "@megan/core/platform/types";
import { todayIso } from "@megan/core/srs/schedule";

import type { CardSource } from "../context";
import { loadCards, loadDueCards, loadStarred, type Card } from "../data/cards";

/** Excluded cards are kept out of study, as on desktop. */
export async function loadSource(db: SqlDriver, source: CardSource): Promise<Card[]> {
  const cards =
    source.kind === "deck"
      ? await loadCards(db, source.examId)
      : source.kind === "due"
        ? await loadDueCards(db, todayIso())
        : await loadStarred(db);
  return cards.filter((card) => !card.excluded);
}

/** Every card of each deck in the session, for multiple-choice distractors. */
export async function loadDecksOf(db: SqlDriver, cards: Card[]): Promise<Card[]> {
  const ids = [...new Set(cards.map((card) => card.examId))];
  const decks = await Promise.all(ids.map((id) => loadCards(db, id)));
  return decks.flat();
}

export function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Study-screen keys; a key typed into a field belongs to the field. */
export function useKeys(handler: (event: KeyboardEvent) => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      latest.current(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** A deterministic shuffle for one session. */
export function shuffled<T>(items: T[], seed = Date.now()): T[] {
  const out = [...items];
  let state = seed % 2147483647 || 1;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 16807) % 2147483647;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
