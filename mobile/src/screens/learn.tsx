/**
 * Learn: the same ladder as the desktop — multiple choice first, then typed
 * recall right away, after other cards, and once more later in the round.
 * Typed answers are marked on meaning when a key is set, on key points when
 * not. Keys: 1–4 pick an option, Enter continues, K marks "I know this".
 */
import { useEffect, useMemo, useState } from "react";

import {
  applyOutcome,
  LEARN_MODES,
  nextStep,
  roundSummary,
  skipAsKnown,
  startRound,
  type LearnMode,
  type RoundState,
  type Step,
} from "@megan/core/learn/ladder";
import { buildMcq, type McqOption } from "@megan/core/learn/mcq";
import { DEFAULT_ROUND_SIZE } from "@megan/core/learn/round-size";
import type { TypedGrade } from "@megan/core/learn/typed";

import { useApp, type CardSource } from "../context";
import { recordLearn, type Card } from "../data/cards";
import { rescheduleReminders } from "../data/reminders";
import { Button, Empty, Notice, Screen, plural } from "../components/ui";

import { markTyped, VERDICT_LABELS } from "./mark";
import { errorText, loadDecksOf, loadSource, shuffled, useKeys } from "./source";

const MODE_LABELS: Record<LearnMode, { title: string; detail: string }> = {
  longterm: { title: "Long-term", detail: "Spaced out so it sticks for months." },
  cram: { title: "Cram", detail: "Exam in a day or two: tighter, with extra passes." },
};

const STAGE_LABELS: Record<Step["stage"], string> = {
  mcq: "Pick the answer",
  typed_immediate: "Type the answer",
  typed_interleaved: "Type it again",
  typed_delayed: "One last time",
};

/** Not-yet-known cards first, so a round spends its time where it counts. */
function byNeed(cards: Card[]): Card[] {
  const rank = (card: Card) => {
    const state = card.progress?.state;
    return state === "recognition" ? 0 : !state || state === "unstudied" ? 1 : state === "immediate_recall" ? 2 : 3;
  };
  return shuffled(cards).sort((a, b) => rank(a) - rank(b));
}

type Answered =
  | { kind: "mcq"; step: Step; picked: number; options: McqOption[] }
  | { kind: "typed"; step: Step; answer: string; grade: TypedGrade };

export function LearnScreen({ source, title }: { source: CardSource; title: string }) {
  const { db, ai, platform, changed } = useApp();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [deck, setDeck] = useState<Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<LearnMode | null>(null);
  const [offset, setOffset] = useState(0);
  const [round, setRound] = useState<RoundState | null>(null);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [typed, setTyped] = useState("");
  const [guessed, setGuessed] = useState(false);
  const [marking, setMarking] = useState(false);

  const sourceKey = JSON.stringify(source);
  useEffect(() => {
    let live = true;
    (async () => {
      const found = byNeed(await loadSource(db, source));
      const all = await loadDecksOf(db, found);
      if (live) {
        setCards(found);
        setDeck(all);
      }
    })().catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, sourceKey]);

  const byId = useMemo(() => new Map((cards ?? []).map((card) => [card.id, card])), [cards]);
  const step = useMemo(() => (round ? nextStep(round) : null), [round]);
  const card = step ? byId.get(step.cardId) : undefined;
  const finished = round !== null && step === null;

  const options = useMemo(
    () => (step?.stage === "mcq" && card ? buildMcq(card, deck, { seed: step.index + 1 }) : []),
    [step, card, deck],
  );

  useEffect(() => {
    if (!finished) return;
    changed();
    void rescheduleReminders(db, platform.notifications).catch(() => undefined);
  }, [finished, db, platform, changed]);

  function begin(chosen: LearnMode, from = offset) {
    if (!cards) return;
    const ids = cards.slice(from, from + DEFAULT_ROUND_SIZE).map((c) => c.id);
    setMode(chosen);
    setOffset(from);
    setRound(startRound(ids, { mode: chosen }));
    setAnswered(null);
  }

  async function record(at: Step, correct: boolean, extra: { metPoints?: string[]; verdict?: TypedGrade["verdict"] } = {}) {
    if (!round || !mode) return;
    const outcome = { correct, guessed: guessed || undefined };
    await recordLearn(db, at.cardId, at, { ...outcome, ...extra }, mode);
    setRound(applyOutcome(round, at, outcome));
    void platform.haptics.impact(correct ? "success" : "warning");
  }

  async function pick(index: number) {
    if (!step || answered || !options[index]) return;
    setAnswered({ kind: "mcq", step, picked: index, options });
    try {
      await record(step, options[index].correct);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function submitTyped() {
    if (!step || !card || answered || marking || !typed.trim()) return;
    setMarking(true);
    setError(null);
    const request = {
      question: card.question,
      expected: card.directAnswer,
      essentialPoints: card.essentialPoints,
      optionalPoints: card.optionalPoints,
      misconceptions: card.misconceptions,
      answer: typed,
    };
    try {
      const grade = await markTyped(ai, request);
      setAnswered({ kind: "typed", step, answer: typed, grade });
      await record(step, grade.verdict === "correct", { metPoints: grade.metPoints, verdict: grade.verdict });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setMarking(false);
    }
  }

  function proceed() {
    setAnswered(null);
    setTyped("");
    setGuessed(false);
  }

  function knowIt() {
    if (!round || !step || answered) return;
    setRound(skipAsKnown(round, step.cardId));
  }

  useKeys((event) => {
    if (answered && event.key === "Enter") {
      event.preventDefault();
      proceed();
    } else if (!answered && step?.stage === "mcq" && /^[1-9]$/.test(event.key)) {
      void pick(Number(event.key) - 1);
    } else if (!answered && step && event.key.toLowerCase() === "k") {
      knowIt();
    }
  });

  if (error && !cards) {
    return (
      <Screen title={title}>
        <Notice tone="error">{error}</Notice>
      </Screen>
    );
  }
  if (cards && cards.length === 0) {
    return (
      <Screen title={title}>
        <Empty title="No cards here">Nothing to learn in this set right now.</Empty>
      </Screen>
    );
  }

  if (!round || !mode) {
    return (
      <Screen title={title}>
        <div className="section">
          <h2 className="section-title">How are you studying?</h2>
          <div className="list">
            {LEARN_MODES.map((id) => (
              <button key={id} type="button" className="row" onClick={() => begin(id)} disabled={!cards}>
                <span className="row-main">
                  <span className="row-title">{MODE_LABELS[id].title}</span>
                  <span className="row-sub">{MODE_LABELS[id].detail}</span>
                </span>
              </button>
            ))}
          </div>
          {cards ? (
            <p className="muted small">
              Rounds of {plural(Math.min(DEFAULT_ROUND_SIZE, cards.length), "card")}, from {plural(cards.length, "card")} in this
              set.
            </p>
          ) : null}
        </div>
      </Screen>
    );
  }

  if (finished) {
    const summary = roundSummary(round);
    const more = cards !== null && offset + DEFAULT_ROUND_SIZE < cards.length;
    return (
      <Screen title={title}>
        <div className="panel stack">
          <h2>Round done</h2>
          <div className="stat-row">
            <div className="stat">
              <strong>{summary.mastered}</strong>
              <span>Recalled</span>
            </div>
            <div className="stat">
              <strong>{summary.recognized}</strong>
              <span>Recognised</span>
            </div>
            <div className="stat">
              <strong>{summary.struggled}</strong>
              <span>Struggled</span>
            </div>
          </div>
          {more ? (
            <Button onClick={() => begin(mode, offset + DEFAULT_ROUND_SIZE)}>Next round</Button>
          ) : (
            <p className="muted">That was every card in this set.</p>
          )}
          <Button variant="secondary" onClick={() => begin(mode, offset)}>
            Repeat this round
          </Button>
        </div>
      </Screen>
    );
  }

  const progress = round.concepts.length
    ? (round.concepts.filter((c) => c.tier === "immediate_recall").length / round.concepts.length) * 100
    : 0;

  return (
    <Screen title={title}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <span style={{ width: `${progress}%` }} />
      </div>

      {card && step ? (
        <div className="stack">
          <p className="section-title">{STAGE_LABELS[step.stage]}</p>
          <div className="panel">
            {card.topic ? <p className="muted small">{card.topic}</p> : null}
            <p className="flashcard-question">{card.question}</p>
          </div>

          {step.stage === "mcq" ? (
            <div className="options" role="list">
              {(answered?.kind === "mcq" ? answered.options : options).map((option, i) => {
                const state =
                  answered?.kind === "mcq"
                    ? option.correct
                      ? "correct"
                      : answered.picked === i
                        ? "wrong"
                        : undefined
                    : undefined;
                return (
                  <button
                    key={`${step.index}:${i}`}
                    type="button"
                    className="option"
                    data-state={state}
                    disabled={!!answered}
                    onClick={() => void pick(i)}
                  >
                    <span className="option-key">{i + 1}</span>
                    <span>{option.text}</span>
                    {answered && !option.correct && option.debrief && state === "wrong" ? (
                      <span className="option-debrief">{option.debrief}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : answered?.kind === "typed" ? (
            <div className="stack">
              <div className={`verdict verdict-${answered.grade.verdict}`} role="status">
                <strong>
                  {VERDICT_LABELS[answered.grade.verdict]}
                </strong>
                {answered.grade.feedback ? <p>{answered.grade.feedback}</p> : null}
                {answered.grade.missedPoints.length ? (
                  <ul className="points">
                    {answered.grade.missedPoints.map((point) => (
                      <li key={point}>Missed: {point}</li>
                    ))}
                  </ul>
                ) : null}
                {answered.grade.provisional ? <p className="muted small">Marked on key points — add an AI key in Settings to mark on meaning.</p> : null}
              </div>
              <div className="panel">
                <p className="muted small">Your answer</p>
                <p>{answered.answer}</p>
                <p className="muted small">Model answer</p>
                <p className="flashcard-answer">{card.directAnswer}</p>
              </div>
            </div>
          ) : (
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                void submitTyped();
              }}
            >
              <label className="field">
                <span className="visually-hidden">Your answer</span>
                <textarea
                  className="textarea"
                  rows={3}
                  value={typed}
                  autoFocus
                  autoCapitalize="sentences"
                  placeholder="Type your answer"
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitTyped();
                    }
                  }}
                />
              </label>
              <Button type="submit" disabled={!typed.trim() || marking}>
                {marking ? "Marking…" : "Check"}
              </Button>
            </form>
          )}

          {answered ? (
            <Button onClick={proceed}>Continue</Button>
          ) : (
            <div className="inline">
              <label className="switch">
                <span>I guessed</span>
                <input type="checkbox" checked={guessed} onChange={(event) => setGuessed(event.target.checked)} />
              </label>
              <Button variant="ghost" onClick={knowIt}>
                I know this
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </Screen>
  );
}
