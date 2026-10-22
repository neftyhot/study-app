/**
 * The tutor: a conversation about one deck (or none), with the deck's cards
 * as context so "card 4" means card 4, and "Make cards" to keep what was said.
 * The same `askTutor`/`extractCards` as the desktop panel.
 */
import { Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ChatTurn } from "@megan/core/llm/types";
import { askTutor, extractCards } from "@megan/core/tutor/ask";
import { QUICK_PROMPTS } from "@megan/core/tutor/prompts";

import { useApp } from "../context";
import { loadCards, type Card } from "../data/cards";
import { listCourses } from "../data/decks";
import { createScanDeck, saveScanCards } from "../data/scan";
import { Button, Empty, Notice, Screen, plural, useLoad } from "../components/ui";

import { errorText } from "./source";

/** Keeps a big deck's context to a size a phone sends comfortably. */
const CONTEXT_CHARS = 60_000;

/** Numbered exactly as the desktop numbers them (src/lib/tutor/context.ts). */
function cardsText(cards: Card[]) {
  const text = cards
    .map((card, index) =>
      [`Flashcard #${index + 1}${card.topic ? ` · ${card.topic}` : ""}`, `Q: ${card.question.trim()}`, `A: ${card.directAnswer.trim()}`].join(
        "\n",
      ),
    )
    .join("\n\n");
  return text.slice(0, CONTEXT_CHARS);
}

/** The slide excerpts the cards came from: the closest thing to the slides a phone has. */
function materialText(cards: Card[]) {
  const excerpts = [...new Set(cards.map((card) => card.sourceExcerpt?.trim()).filter((text): text is string => !!text))];
  return excerpts.join("\n\n").slice(0, CONTEXT_CHARS);
}

export function TutorScreen({ examId }: { examId?: string }) {
  return (
    <Screen title="Tutor">
      <TutorPanel examId={examId} />
    </Screen>
  );
}

export function TutorPanel({ examId: initialDeck }: { examId?: string }) {
  const { db, ai, navigate, selectTab, changed } = useApp();
  const [examId, setExamId] = useState(initialDeck ?? "");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"ask" | "cards" | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);

  // Opening the tutor from another deck switches to it.
  const [opened, setOpened] = useState(initialDeck);
  if (opened !== initialDeck) {
    setOpened(initialDeck);
    setExamId(initialDeck ?? "");
  }

  const { data: decks } = useLoad(async () => (await listCourses(db)).flatMap((course) => course.decks), []);
  const { data: cards } = useLoad(async () => (examId ? loadCards(db, examId) : []), [examId]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns, busy]);

  if (!ai) {
    return (
      <Empty title="The tutor needs an AI key">
        <p>Add a Gemini API key in Settings. Studying, Learn and practice exams work without one.</p>
        <Button onClick={() => selectTab("settings")}>Open Settings</Button>
      </Empty>
    );
  }
  const provider = ai;

  async function ask(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next: ChatTurn[] = [...turns, { role: "user", text: question }];
    setTurns(next);
    setDraft("");
    setSuggestions([]);
    setMessage(null);
    setBusy("ask");
    try {
      const own = cards ?? [];
      const answer = await askTutor(provider, next, materialText(own), cardsText(own));
      const note = answer.beyondMaterial ? "\n\n(From general knowledge, not your material.)" : "";
      setTurns([...next, { role: "model", text: answer.reply + note }]);
      setSuggestions(answer.suggestions ?? []);
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    } finally {
      setBusy(null);
    }
  }

  async function makeCards() {
    if (busy || turns.length === 0) return;
    setMessage(null);
    setBusy("cards");
    try {
      const own = cards ?? [];
      const made = await extractCards(provider, { turns, material: materialText(own), cards: cardsText(own) });
      if (made.length === 0) {
        setMessage({ tone: "info", text: "Nothing in this conversation made a good card yet." });
        return;
      }
      const target = examId || (await createScanDeck(db, "From the tutor"));
      const saved = await saveScanCards(db, target, made);
      changed();
      setMessage({ tone: "info", text: `Added ${plural(saved, "card")}.` });
      if (!examId) navigate({ name: "deck", examId: target });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="chat">
      <label className="field">
        <span className="field-label">Deck</span>
        <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)} disabled={!!busy}>
          <option value="">No deck — general questions</option>
          {decks?.map((deck) => (
            <option key={deck.examId} value={deck.examId}>
              {deck.title}
            </option>
          ))}
        </select>
      </label>

      <div className="chat-log" ref={log} aria-live="polite">
        {turns.length === 0 ? (
          <div className="stack">
            <p className="muted">
              {examId
                ? `Ask about this deck. "Card ${Math.min(3, cards?.length || 1)}" means flashcard #${Math.min(3, cards?.length || 1)}.`
                : "Ask anything, or pick a deck so answers come from your material."}
            </p>
            <div className="segmented">
              {QUICK_PROMPTS.map((quick) => (
                <button key={quick.label} type="button" className="chip" onClick={() => void ask(quick.prompt)}>
                  {quick.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {turns.map((turn, index) => (
          <p key={index} className={`bubble bubble-${turn.role}`}>
            {turn.text}
          </p>
        ))}
        {busy === "ask" ? <p className="bubble bubble-model muted">Thinking…</p> : null}
      </div>

      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {suggestions.length > 0 ? (
        <div className="segmented">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="chip" onClick={() => void ask(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      {turns.length > 0 ? (
        <Button variant="secondary" onClick={() => void makeCards()} disabled={!!busy}>
          <Sparkles aria-hidden /> {busy === "cards" ? "Making cards…" : "Make cards from this"}
        </Button>
      ) : null}

      <form
        className="chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(draft);
        }}
      >
        <textarea
          className="textarea"
          rows={1}
          value={draft}
          placeholder="Ask the tutor"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draft);
            }
          }}
        />
        <Button type="submit" label="Send" disabled={!draft.trim() || !!busy}>
          <Send aria-hidden />
        </Button>
      </form>
    </div>
  );
}
