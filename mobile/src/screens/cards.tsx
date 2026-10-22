/**
 * Flashcards, flip or swipe. Swipe right for easy, left for missed, with an
 * undo; the three grade buttons and the keys 1/2/3 do the same without a
 * gesture. Space flips, Z undoes, R reads the card aloud, S stars it.
 */
import { Star, Undo2, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";

import type { Grade } from "@megan/core/study/grade";

import { useApp, type CardSource } from "../context";
import { recordFlip, setStarred, undoGrade, type Card, type Undo } from "../data/cards";
import { rescheduleReminders } from "../data/reminders";
import { Button, Empty, Notice, Screen, plural } from "../components/ui";

import { errorText, loadSource, shuffled, useKeys } from "./source";

/** How far a card must travel, in pixels, before letting go grades it. */
const SWIPE_DISTANCE = 96;

const GRADE_LABELS: Record<Grade, string> = { missed: "Missed", difficult: "Hard", easy: "Easy" };

export function CardsScreen({ source, title, swipe = false }: { source: CardSource; title: string; swipe?: boolean }) {
  const { db, platform } = useApp();
  // The deck is read once: grading must not reshuffle the cards under the student.
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    let live = true;
    loadSource(db, source).then(
      (found) => live && setCards(source.kind === "deck" ? found : shuffled(found)),
      (cause) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, sourceKey]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [undo, setUndo] = useState<{ undo: Undo; grade: Grade } | null>(null);
  const [tally, setTally] = useState<Record<Grade, number>>({ missed: 0, difficult: 0, easy: 0 });
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const graded = useRef(false);

  const card = cards?.[index];
  const done = cards !== null && index >= cards.length;

  // Reminders carry tomorrow's due count; refresh them once the session ends.
  useEffect(() => {
    if (!done || !graded.current) return;
    void rescheduleReminders(db, platform.notifications).catch(() => undefined);
  }, [done, db, platform]);

  useEffect(() => () => void platform.speech.stop(), [platform]);

  async function grade(value: Grade) {
    if (!card) return;
    try {
      const saved = await recordFlip(db, card.id, value);
      graded.current = true;
      void platform.haptics.impact(value === "missed" ? "warning" : value === "easy" ? "success" : "tap");
      setUndo({ undo: saved, grade: value });
      setTally((t) => ({ ...t, [value]: t[value] + 1 }));
      setIndex((i) => i + 1);
      setFlipped(false);
      setDrag(0);
      void platform.speech.stop();
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function revert() {
    if (!undo) return;
    await undoGrade(db, undo.undo);
    setTally((t) => ({ ...t, [undo.grade]: Math.max(0, t[undo.grade] - 1) }));
    setIndex((i) => Math.max(0, i - 1));
    setFlipped(false);
    setUndo(null);
  }

  async function toggleStar() {
    if (!card || !cards) return;
    await setStarred(db, card.id, !card.starred);
    void platform.haptics.impact("tap");
    setCards(cards.map((c) => (c.id === card.id ? { ...c, starred: !c.starred } : c)));
  }

  function readAloud() {
    if (!card || !platform.speech.available) return;
    void platform.speech.speak(flipped ? card.directAnswer : card.question);
  }

  useKeys((event) => {
    if (!card) {
      if (event.key.toLowerCase() === "z" && undo) void revert();
      return;
    }
    const key = event.key.toLowerCase();
    if (key === " " || key === "enter") {
      event.preventDefault();
      setFlipped((f) => !f);
    } else if (key === "1") void grade("missed");
    else if (key === "2") void grade("difficult");
    else if (key === "3") void grade("easy");
    else if (key === "arrowleft" && swipe) void grade("missed");
    else if (key === "arrowright" && swipe) void grade("easy");
    else if (key === "z" && undo) void revert();
    else if (key === "r") readAloud();
    else if (key === "s") void toggleStar();
  });

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!swipe) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!start.current || start.current.id !== event.pointerId) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    if (drag === 0 && Math.abs(dy) > Math.abs(dx)) return; // a scroll, not a swipe
    if (Math.abs(dx) > 8) event.currentTarget.setPointerCapture(event.pointerId);
    setDrag(dx);
  }

  function onPointerUp() {
    const dx = drag;
    start.current = null;
    if (dx > SWIPE_DISTANCE) void grade("easy");
    else if (dx < -SWIPE_DISTANCE) void grade("missed");
    else if (Math.abs(dx) < 8) setFlipped((f) => !f);
    setDrag(0);
  }

  const reach = Math.min(1, Math.abs(drag) / SWIPE_DISTANCE);
  const progress = cards && cards.length > 0 ? (Math.min(index, cards.length) / cards.length) * 100 : 0;

  const actions = useMemo(
    () =>
      card ? (
        <>
          {platform.speech.available ? (
            <button type="button" className="icon-button" aria-label="Read aloud" onClick={readAloud}>
              <Volume2 aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label={card.starred ? "Unstar" : "Star"}
            aria-pressed={card.starred}
            onClick={() => void toggleStar()}
          >
            <Star aria-hidden fill={card.starred ? "currentColor" : "none"} />
          </button>
        </>
      ) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, flipped, cards],
  );

  return (
    <Screen title={title} actions={actions}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {cards && cards.length === 0 ? <Empty title="No cards here">Nothing to study in this set right now.</Empty> : null}

      {cards && cards.length > 0 ? (
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={index}>
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}

      {card ? (
        <>
          <div
            className={drag !== 0 ? "flashcard flashcard-dragging" : "flashcard"}
            style={drag !== 0 ? { transform: `translateX(${drag}px) rotate(${drag / 24}deg)` } : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              start.current = null;
              setDrag(0);
            }}
            onClick={swipe ? undefined : () => setFlipped((f) => !f)}
            role="button"
            tabIndex={0}
            aria-label={flipped ? "Answer. Tap to see the question." : "Question. Tap to see the answer."}
          >
            {swipe ? (
              <>
                <span className="flashcard-stamp flashcard-stamp-easy" style={{ opacity: drag > 0 ? reach : 0 }} aria-hidden>
                  Easy
                </span>
                <span className="flashcard-stamp flashcard-stamp-missed" style={{ opacity: drag < 0 ? reach : 0 }} aria-hidden>
                  Missed
                </span>
              </>
            ) : null}
            {card.topic ? <span className="flashcard-topic">{card.topic}</span> : null}
            <p className="flashcard-question">{card.question}</p>
            {flipped ? (
              <>
                <p className="flashcard-answer">{card.directAnswer}</p>
                {card.fullExplanation ? <p className="muted small">{card.fullExplanation}</p> : null}
              </>
            ) : (
              <span className="flashcard-hint">
                {swipe ? "Tap to flip · swipe right if easy, left if missed" : "Tap to see the answer"}
              </span>
            )}
          </div>

          <p className="muted small" aria-live="polite">
            Card {index + 1} of {cards?.length}
          </p>

          {flipped || swipe ? (
            <div className="grades">
              {(["missed", "difficult", "easy"] as const).map((value, i) => (
                <button key={value} type="button" className={`button button-secondary grade-${value}`} onClick={() => void grade(value)}>
                  {GRADE_LABELS[value]}
                  <span className="visually-hidden"> (key {i + 1})</span>
                </button>
              ))}
            </div>
          ) : (
            <Button onClick={() => setFlipped(true)}>Show answer</Button>
          )}
        </>
      ) : null}

      {done && cards.length > 0 ? (
        <div className="panel stack">
          <h2>Done — {plural(cards.length, "card")}</h2>
          <div className="stat-row">
            <div className="stat">
              <strong>{tally.easy}</strong>
              <span>Easy</span>
            </div>
            <div className="stat">
              <strong>{tally.difficult}</strong>
              <span>Hard</span>
            </div>
            <div className="stat">
              <strong>{tally.missed}</strong>
              <span>Missed</span>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              setIndex(0);
              setTally({ missed: 0, difficult: 0, easy: 0 });
              setUndo(null);
            }}
          >
            Go through again
          </Button>
        </div>
      ) : null}

      {undo ? (
        <div className="toast" role="status">
          <span>Marked {GRADE_LABELS[undo.grade].toLowerCase()}</span>
          <button type="button" className="button button-ghost" onClick={() => void revert()}>
            <Undo2 aria-hidden /> Undo
          </button>
        </div>
      ) : null}
    </Screen>
  );
}

