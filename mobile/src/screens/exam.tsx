/**
 * A practice exam: a mix of multiple choice and typed questions drawn from
 * the deck, answered one at a time and marked at the end. Practice only — it
 * does not move cards in the review schedule.
 */
import { useEffect, useMemo, useState } from "react";

import {
  assignFormats,
  DEFAULT_QUESTION_COUNT,
  selectCards,
  type DraftQuestion,
  type PaperCard,
} from "@megan/core/exam/paper";
import { buildMcq, type McqOption } from "@megan/core/learn/mcq";
import type { TypedGrade } from "@megan/core/learn/typed";

import { useApp } from "../context";
import { loadCards, type Card } from "../data/cards";
import { Button, Empty, Notice, Screen, plural } from "../components/ui";

import { markTyped, VERDICT_LABELS } from "./mark";
import { errorText, useKeys } from "./source";

const COUNTS = [10, DEFAULT_QUESTION_COUNT, 30] as const;

type Question = DraftQuestion & { options: McqOption[] };
type Answer = { picked?: number; typed?: string };
type Result = { correct: boolean; score: number; grade?: TypedGrade };

function toPaper(card: Card): PaperCard {
  return {
    id: card.id,
    topic: card.topic,
    question: card.question,
    directAnswer: card.directAnswer,
    essentialPoints: card.essentialPoints,
    misconceptions: card.misconceptions,
    cardType: card.cardType,
    state: card.progress?.state ?? null,
    excluded: card.excluded,
    sourceFileId: null,
    slideIndex: null,
  } as PaperCard;
}

/** A new paper each time: the seed only needs to differ between starts. */
function freshSeed() {
  return Date.now() % 2147483646;
}

export function ExamScreen({ examId, title }: { examId: string; title: string }) {
  const { db, ai } = useApp();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [at, setAt] = useState(0);
  const [results, setResults] = useState<Result[] | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    let live = true;
    loadCards(db, examId)
      .then((found) => live && setCards(found.filter((card) => !card.excluded)))
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [db, examId]);

  const byId = useMemo(() => new Map((cards ?? []).map((card) => [card.id, card])), [cards]);

  function start(count: number) {
    if (!cards) return;
    const seed = freshSeed();
    const paper = assignFormats(selectCards(cards.map(toPaper), { questionCount: count, seed }), undefined, seed);
    setQuestions(
      paper.map((q, i) => ({
        ...q,
        options: q.format === "mcq" ? buildMcq(byId.get(q.card.id)!, cards, { seed: seed + i }) : [],
      })),
    );
    setAnswers(paper.map(() => ({})));
    setAt(0);
    setResults(null);
  }

  async function finish() {
    if (!questions) return;
    setMarking(true);
    setError(null);
    try {
      const marked: Result[] = [];
      for (const [i, q] of questions.entries()) {
        const answer = answers[i] ?? {};
        if (q.format === "mcq") {
          const correct = answer.picked !== undefined && !!q.options[answer.picked]?.correct;
          marked.push({ correct, score: correct ? 1 : 0 });
          continue;
        }
        const card = byId.get(q.card.id)!;
        if (!answer.typed?.trim()) {
          marked.push({ correct: false, score: 0 });
          continue;
        }
        const grade = await markTyped(ai, {
          question: card.question,
          expected: card.directAnswer,
          essentialPoints: card.essentialPoints,
          optionalPoints: card.optionalPoints,
          misconceptions: card.misconceptions,
          answer: answer.typed,
        });
        marked.push({
          correct: grade.verdict === "correct",
          score: grade.verdict === "correct" ? 1 : grade.verdict === "partial" ? 0.5 : 0,
          grade,
        });
      }
      setResults(marked);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setMarking(false);
    }
  }

  function answer(patch: Answer) {
    setAnswers((all) => all.map((a, i) => (i === at ? { ...a, ...patch } : a)));
  }

  const question = questions?.[at];
  useKeys((event) => {
    if (!question || results) return;
    if (question.format === "mcq" && /^[1-9]$/.test(event.key) && question.options[Number(event.key) - 1]) {
      answer({ picked: Number(event.key) - 1 });
    } else if (event.key === "ArrowRight" && at < (questions?.length ?? 0) - 1) {
      setAt(at + 1);
    } else if (event.key === "ArrowLeft" && at > 0) {
      setAt(at - 1);
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
        <Empty title="No cards in this deck">A practice exam is made from the deck&apos;s cards.</Empty>
      </Screen>
    );
  }

  if (!questions) {
    return (
      <Screen title={`${title} · Practice exam`}>
        <div className="section">
          <h2 className="section-title">How many questions?</h2>
          <div className="list">
            {COUNTS.filter((n, i) => i === 0 || n <= (cards?.length ?? 0)).map((n) => (
              <button key={n} type="button" className="row" disabled={!cards} onClick={() => start(n)}>
                <span className="row-main">
                  <span className="row-title">{plural(Math.min(n, cards?.length ?? n), "question")}</span>
                  <span className="row-sub">Mostly multiple choice, some typed</span>
                </span>
              </button>
            ))}
          </div>
          <p className="muted small">Typed answers are marked when you finish. Practice exams don&apos;t change your review schedule.</p>
        </div>
      </Screen>
    );
  }

  if (results) {
    const total = results.reduce((sum, r) => sum + r.score, 0);
    const percent = Math.round((total / Math.max(1, results.length)) * 100);
    return (
      <Screen title={`${title} · Results`}>
        <div className="hero">
          <h2>{percent}%</h2>
          <p>
            {total % 1 === 0 ? total : total.toFixed(1)} out of {results.length}
          </p>
        </div>
        <div className="list">
          {questions.map((q, i) => {
            const card = byId.get(q.card.id)!;
            const result = results[i];
            const answer = answers[i] ?? {};
            const given = q.format === "mcq" ? (answer.picked !== undefined ? q.options[answer.picked]?.text : undefined) : answer.typed;
            return (
              <div className="panel stack" key={q.card.id}>
                <p className="row-title">
                  {i + 1}. {card.question}
                </p>
                <p className={`verdict verdict-${result.grade?.verdict ?? (result.correct ? "correct" : "incorrect")}`}>
                  <strong>{result.grade ? VERDICT_LABELS[result.grade.verdict] : result.correct ? "Correct" : "Wrong"}</strong>
                </p>
                <p className="muted small">Your answer: {given?.trim() || "—"}</p>
                {!result.correct ? <p className="flashcard-answer">{card.directAnswer}</p> : null}
                {result.grade?.feedback ? <p className="small">{result.grade.feedback}</p> : null}
              </div>
            );
          })}
        </div>
        <Button onClick={() => setQuestions(null)}>New exam</Button>
      </Screen>
    );
  }

  const card = question ? byId.get(question.card.id) : undefined;
  const current = answers[at] ?? {};
  const answeredCount = answers.filter((a) => a.picked !== undefined || a.typed?.trim()).length;

  return (
    <Screen title={`${title} · ${at + 1} of ${questions.length}`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={at + 1}>
        <span style={{ width: `${((at + 1) / questions.length) * 100}%` }} />
      </div>
      {question && card ? (
        <div className="stack">
          <div className="panel">
            {card.topic ? <p className="muted small">{card.topic}</p> : null}
            <p className="flashcard-question">{card.question}</p>
          </div>
          {question.format === "mcq" ? (
            <div className="options" role="list">
              {question.options.map((option, i) => (
                <button
                  key={i}
                  type="button"
                  className="option"
                  aria-pressed={current.picked === i}
                  onClick={() => answer({ picked: i })}
                >
                  <span className="option-key">{i + 1}</span>
                  <span>{option.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <label className="field">
              <span className="field-label">Your answer</span>
              <textarea
                className="textarea"
                rows={4}
                value={current.typed ?? ""}
                autoCapitalize="sentences"
                onChange={(event) => answer({ typed: event.target.value })}
              />
            </label>
          )}
          <div className="inline">
            <Button variant="secondary" disabled={at === 0} onClick={() => setAt(at - 1)}>
              Previous
            </Button>
            {at < questions.length - 1 ? (
              <Button onClick={() => setAt(at + 1)}>Next</Button>
            ) : (
              <Button disabled={marking} onClick={() => void finish()}>
                {marking ? "Marking…" : "Finish and mark"}
              </Button>
            )}
          </div>
          <p className="muted small">
            {answeredCount} of {questions.length} answered
          </p>
        </div>
      ) : null}
    </Screen>
  );
}
