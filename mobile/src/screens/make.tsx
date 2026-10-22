/**
 * "Make a deck": cards from a file (slides, PDF, Word, text, a Quizlet or
 * Anki export, a spreadsheet), from pasted text, or typed by hand. Files and
 * notes go through the desktop's extractors and an AI pass per batch;
 * anything that is already cards is saved as typed, with no AI. A review list
 * comes first either way, then a new deck in "My notes".
 */
import { ClipboardPaste, FileUp, PencilLine, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { guessSideSeparator, parseImportedCards, type ImportedCard } from "@megan/core/cards/import";
import {
  batchUnits,
  cardsFromDocument,
  cardsFromText,
  estimateFromPdf,
  estimateFromText,
  type FileEstimate,
  type TextBatch,
} from "@megan/core/generate/from-text";
import { extractPlainText } from "@megan/core/ingest/text";
import type { ExtractedCard } from "@megan/core/tutor/schemas";

import { useApp } from "../context";
import { saveTypedCards } from "../data/make";
import { createNotesDeck, saveExtractedCards } from "../data/scan";
import { MAKE_ACCEPT, readMaterial } from "../lib/ingest";
import { toBase64 } from "../platform/shared";
import { Button, Empty, Notice, Screen, plural } from "../components/ui";

import { errorText } from "./source";

type Plan =
  | { kind: "text"; batches: TextBatch[]; truncated: boolean; estimate: FileEstimate }
  | { kind: "pdf"; bytes: Uint8Array; pages: number; estimate: FileEstimate };

type Review = { source: "typed"; cards: ImportedCard[] } | { source: "ai"; cards: ExtractedCard[] };

type Step = { name: "start" } | { name: "paste" } | { name: "type" } | { name: "plan"; plan: Plan } | { name: "review"; review: Review };

const BLANK_ROWS: ImportedCard[] = [
  { front: "", back: "" },
  { front: "", back: "" },
  { front: "", back: "" },
];

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

/** `notes` opens straight on "Paste text", filled in (a lecture transcript, say). */
export function MakeScreen({ notes }: { notes?: { title: string; text: string } } = {}) {
  const { db, ai, platform, navigate, selectTab, changed } = useApp();
  const [step, setStep] = useState<Step>(notes ? { name: "paste" } : { name: "start" });
  const [title, setTitle] = useState(notes?.title ?? "");
  const [pasted, setPasted] = useState(notes?.text ?? "");
  const [rows, setRows] = useState<ImportedCard[]>(BLANK_ROWS);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = progress !== null;

  function startOver() {
    setStep({ name: "start" });
    setError(null);
    setTitle("");
  }

  function planText(units: Parameters<typeof batchUnits>[0], unitName: string) {
    if (!ai) return;
    const { batches, truncated } = batchUnits(units, unitName);
    if (batches.length === 0) {
      setError("There's no text in that to make cards from.");
      return;
    }
    setStep({ name: "plan", plan: { kind: "text", batches, truncated, estimate: estimateFromText(ai.model, batches.length) } });
  }

  async function pickFile() {
    setError(null);
    try {
      const [file] = await platform.files.pickFiles({ accept: MAKE_ACCEPT });
      if (!file) return;
      setProgress(`Reading ${file.name}…`);
      const material = await readMaterial(file);
      if (!title) setTitle(baseName(file.name));
      if (material.kind === "cards") {
        setStep({ name: "review", review: { source: "typed", cards: material.cards } });
      } else if (!ai) {
        setError("Making cards from a file takes an AI key. Add one in Settings. (A Quizlet or Anki export works without one.)");
      } else if (material.kind === "scanned-pdf") {
        setStep({
          name: "plan",
          plan: { kind: "pdf", bytes: file.bytes, pages: material.pages, estimate: estimateFromPdf(ai.model, material.pages) },
        });
      } else {
        planText(material.result.units, material.unitName);
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setProgress(null);
    }
  }

  function takePastedAsCards() {
    setError(null);
    const { cards } = parseImportedCards(pasted, { sideSeparator: guessSideSeparator(pasted), cardSeparator: "\n" });
    const complete = cards.filter((card) => card.front.trim() && card.back.trim());
    if (complete.length === 0) {
      setError("No cards found. Each line should be a term, then a tab or comma, then its definition.");
      return;
    }
    setStep({ name: "review", review: { source: "typed", cards: complete } });
  }

  function takePastedAsNotes() {
    setError(null);
    planText(extractPlainText(pasted).units, "Section");
  }

  async function generate(plan: Plan) {
    if (!ai) return;
    setError(null);
    const found: ExtractedCard[] = [];
    try {
      if (plan.kind === "pdf") {
        setProgress(`Reading ${plural(plan.pages, "page")}…`);
        found.push(...(await cardsFromDocument(ai, { mimeType: "application/pdf", data: toBase64(plan.bytes) })));
      } else {
        for (const [index, batch] of plan.batches.entries()) {
          setProgress(`Making cards: ${batch.label} (${index + 1} of ${plan.batches.length})…`);
          found.push(...(await cardsFromText(ai, batch)));
        }
      }
      setStep({ name: "review", review: { source: "ai", cards: found } });
    } catch (cause) {
      setError(errorText(cause));
      // Keep what the finished batches made.
      if (found.length > 0) setStep({ name: "review", review: { source: "ai", cards: found } });
    } finally {
      setProgress(null);
    }
  }

  function finishTyping() {
    const complete = rows.filter((row) => row.front.trim() && row.back.trim());
    if (complete.length === 0) {
      setError("Fill in both sides of at least one card.");
      return;
    }
    setError(null);
    setStep({ name: "review", review: { source: "typed", cards: complete } });
  }

  async function save(review: Review) {
    if (review.cards.length === 0) return;
    setError(null);
    try {
      const examId = await createNotesDeck(db, title, "My deck");
      if (review.source === "ai") await saveExtractedCards(db, examId, review.cards, false);
      else await saveTypedCards(db, examId, review.cards);
      changed();
      void platform.haptics.impact("success");
      navigate({ name: "deck", examId });
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function dropCard(index: number) {
    if (step.name !== "review") return;
    const { review } = step;
    setStep({
      name: "review",
      review:
        review.source === "ai"
          ? { source: "ai", cards: review.cards.filter((_, i) => i !== index) }
          : { source: "typed", cards: review.cards.filter((_, i) => i !== index) },
    });
  }

  return (
    <Screen title="Make a deck">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {progress ? <Notice>{progress}</Notice> : null}

      {step.name === "start" ? (
        <>
          <p className="muted">
            Turn slides, a PDF, Word notes or a Quizlet export into flashcards, or write your own. You can check every card
            before saving.
          </p>
          <div className="grid-actions">
            <button type="button" className="action" onClick={() => void pickFile()} disabled={busy}>
              <FileUp aria-hidden />
              <strong>From a file</strong>
              <span>PowerPoint, PDF, Word, text, CSV</span>
            </button>
            <button type="button" className="action" onClick={() => setStep({ name: "paste" })} disabled={busy}>
              <ClipboardPaste aria-hidden />
              <strong>Paste text</strong>
              <span>Notes, or cards from Quizlet</span>
            </button>
            <button type="button" className="action" onClick={() => setStep({ name: "type" })} disabled={busy}>
              <PencilLine aria-hidden />
              <strong>Type cards</strong>
              <span>Front and back, no AI</span>
            </button>
          </div>
          {!ai ? (
            <div className="section">
              <Notice>
                Files and notes are turned into cards by AI, which takes a key. Typing cards and Quizlet or Anki exports work
                without one.
              </Notice>
              <Button variant="secondary" onClick={() => selectTab("settings")}>
                Add a key in Settings
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {step.name === "paste" ? (
        <>
          <label className="field">
            <span className="field-label">Paste here</span>
            <textarea
              className="textarea"
              rows={10}
              value={pasted}
              placeholder={"Notes from class, or a Quizlet export:\nmitosis\tcell division\nATP\tenergy currency"}
              onChange={(e) => setPasted(e.target.value)}
            />
          </label>
          <p className="muted small">
            In Quizlet: open the set → ••• → Export → Copy text. In Anki: File → Export → Notes in Plain Text.
          </p>
          <div className="inline">
            <Button onClick={takePastedAsCards} disabled={!pasted.trim()}>
              These are cards
            </Button>
            <Button variant="secondary" onClick={takePastedAsNotes} disabled={!pasted.trim() || !ai}>
              Make cards from notes
            </Button>
            <Button variant="ghost" onClick={startOver}>
              Back
            </Button>
          </div>
        </>
      ) : null}

      {step.name === "type" ? (
        <>
          {rows.map((row, index) => (
            <div className="section" key={index}>
              <h2 className="section-title">Card {index + 1}</h2>
              <input
                className="input"
                aria-label={`Card ${index + 1} front`}
                placeholder="Front: a question or term"
                value={row.front}
                onChange={(e) => setRows((current) => current.map((r, i) => (i === index ? { ...r, front: e.target.value } : r)))}
              />
              <textarea
                className="textarea"
                aria-label={`Card ${index + 1} back`}
                placeholder="Back: the answer"
                value={row.back}
                onChange={(e) => setRows((current) => current.map((r, i) => (i === index ? { ...r, back: e.target.value } : r)))}
              />
            </div>
          ))}
          <div className="inline">
            <Button variant="secondary" onClick={() => setRows((current) => [...current, { front: "", back: "" }])}>
              <Plus aria-hidden /> Add a card
            </Button>
            <Button onClick={finishTyping}>Done</Button>
            <Button variant="ghost" onClick={startOver}>
              Back
            </Button>
          </div>
        </>
      ) : null}

      {step.name === "plan" ? (
        <>
          <div className="hero">
            <h2>
              {step.plan.kind === "pdf"
                ? `A scanned PDF, ${plural(step.plan.pages, "page")}`
                : `${plural(step.plan.batches.length, "part")} to read`}
            </h2>
            <p>
              {step.plan.kind === "pdf"
                ? "There's no text in it, so the AI will read the pages themselves."
                : "Each part becomes a handful of cards."}{" "}
              Estimated cost: {step.plan.estimate.costLabel}.
            </p>
            {step.plan.kind === "text" && step.plan.truncated ? (
              <p className="muted small">This file is long, so only the first part of it is used. Split it to cover the rest.</p>
            ) : null}
          </div>
          <div className="inline">
            <Button onClick={() => void generate((step as { plan: Plan }).plan)} disabled={busy}>
              Make cards
            </Button>
            <Button variant="ghost" onClick={startOver} disabled={busy}>
              Cancel
            </Button>
          </div>
        </>
      ) : null}

      {step.name === "review" ? (
        <>
          <label className="field">
            <span className="field-label">Deck name</span>
            <input className="input" value={title} placeholder="My deck" onChange={(e) => setTitle(e.target.value)} />
          </label>
          {step.review.cards.length === 0 ? (
            <Empty title="No cards">
              <p>Nothing worth testing was found. Try another file, or type cards yourself.</p>
            </Empty>
          ) : (
            <div className="list">
              {step.review.cards.map((card, index) => (
                <div className="row" key={index}>
                  <span className="row-main">
                    <span className="row-title">{"question" in card ? card.question : card.front}</span>
                    <span className="row-sub">{"directAnswer" in card ? card.directAnswer : card.back}</span>
                  </span>
                  <button type="button" className="icon-button" aria-label={`Drop card ${index + 1}`} onClick={() => dropCard(index)}>
                    <Trash2 aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="inline">
            <Button onClick={() => void save((step as { review: Review }).review)} disabled={step.review.cards.length === 0}>
              Save {plural(step.review.cards.length, "card")}
            </Button>
            <Button variant="ghost" onClick={startOver}>
              Start over
            </Button>
          </div>
        </>
      ) : null}
    </Screen>
  );
}
