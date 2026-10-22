/** One deck: its numbers, every way to study it, sharing, and the desktop-only extras. */
import { BookOpenText, Brain, ClipboardList, Hand, Layers, Library, Share, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";

import { SHARE_MIME, shareFilename } from "@megan/core/share/meganstudy";

import { useApp } from "../context";
import { deleteDeck, listCourses, loadDeck } from "../data/decks";
import { buildShareFile } from "../data/export";
import { Button, DesktopOnly, Notice, Screen, Sheet, plural, useLoad } from "../components/ui";

import { errorText } from "./source";

/** What a deck can do on the desktop and not here. */
const DESKTOP_EXTRAS = ["Image occlusion editor", "Bulk editing", "Publishing to the catalog"];

export function DeckScreen({ examId }: { examId: string }) {
  const { db, platform, navigate, back, changed, openTutor } = useApp();
  const { data, error } = useLoad(async () => {
    const deck = await loadDeck(db, examId);
    const summary = (await listCourses(db)).flatMap((course) => course.decks).find((d) => d.examId === examId);
    return deck ? { ...deck, summary } : null;
  }, [examId]);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);

  if (data === null) {
    return (
      <Screen title="Deck">
        <Notice tone="error">This deck no longer exists.</Notice>
      </Screen>
    );
  }

  const title = data?.title ?? "Deck";
  const summary = data?.summary;
  const source = { kind: "deck" as const, examId };

  async function share(includeGuide: boolean) {
    setSharing(true);
    setMessage(null);
    try {
      const file = await buildShareFile(db, examId, { includeGuide });
      if (!file) return;
      await platform.files.share({ name: shareFilename(file.deck.title), mime: SHARE_MIME, data: JSON.stringify(file, null, 2) });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    } finally {
      setSharing(false);
    }
  }

  async function remove() {
    try {
      await deleteDeck(db, examId);
      changed();
      back();
    } catch (cause) {
      setConfirming(false);
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  return (
    <Screen title={title}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {data ? <p className="muted">{data.course}</p> : null}

      {summary ? (
        <div className="stat-row">
          <div className="stat">
            <strong>{summary.cardCount}</strong>
            <span>Cards</span>
          </div>
          <div className="stat">
            <strong>{summary.dueCount}</strong>
            <span>Due</span>
          </div>
          <div className="stat">
            <strong>{summary.newCount}</strong>
            <span>New</span>
          </div>
          <div className="stat">
            <strong>{summary.starredCount}</strong>
            <span>Starred</span>
          </div>
        </div>
      ) : null}

      <div className="grid-actions">
        <button type="button" className="action" onClick={() => navigate({ name: "cards", source, title })}>
          <Layers aria-hidden />
          <strong>Flashcards</strong>
          <span>Flip and grade</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "cards", source, title, swipe: true })}>
          <Hand aria-hidden />
          <strong>Swipe</strong>
          <span>Right if easy, left if missed</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "learn", source, title })}>
          <Brain aria-hidden />
          <strong>Learn</strong>
          <span>Choose, then type the answer</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "exam", examId, title })}>
          <ClipboardList aria-hidden />
          <strong>Practice exam</strong>
          <span>A mixed paper, marked at the end</span>
        </button>
        {summary?.hasGuide ? (
          <button type="button" className="action" onClick={() => navigate({ name: "guide", examId, title })}>
            <BookOpenText aria-hidden />
            <strong>Study guide</strong>
            <span>With sources for every line</span>
          </button>
        ) : null}
        <button type="button" className="action" onClick={() => openTutor(examId)}>
          <Sparkles aria-hidden />
          <strong>Ask the tutor</strong>
          <span>About this deck</span>
        </button>
      </div>

      <div className="section">
        <h2 className="section-title">Share</h2>
        <div className="list">
          <button type="button" className="row" disabled={sharing} onClick={() => void share(false)}>
            <Share aria-hidden />
            <span className="row-main">
              <span className="row-title">Share the cards</span>
              <span className="row-sub">AirDrop, Messages or Files — no review history goes with them</span>
            </span>
          </button>
          <button type="button" className="row" onClick={() => navigate({ name: "catalog", share: examId })}>
            <Library aria-hidden />
            <span className="row-main">
              <span className="row-title">Share to the catalog</span>
              <span className="row-sub">List it for other students at your college</span>
            </span>
          </button>
          {summary?.hasGuide ? (
            <button type="button" className="row" disabled={sharing} onClick={() => void share(true)}>
              <Share aria-hidden />
              <span className="row-main">
                <span className="row-title">Share with the study guide</span>
              </span>
            </button>
          ) : null}
        </div>
      </div>

      <details className="section">
        <summary className="section-title">More</summary>
        <div className="list">
          {DESKTOP_EXTRAS.map((label) => (
            <DesktopOnly key={label} label={label} />
          ))}
        </div>
      </details>

      <div className="section">
        <div className="list">
          <button type="button" className="row row-danger" onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden />
            <span className="row-main">
              <span className="row-title">Delete this deck</span>
            </span>
          </button>
        </div>
      </div>

      {confirming ? (
        <Sheet title="Delete this deck?" onClose={() => setConfirming(false)}>
          <div className="stack">
            <p>
              “{title}” and its {plural(summary?.cardCount ?? 0, "card")} will be deleted, with their review history. If
              you sync with your computer, it&apos;s deleted there too.
            </p>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      ) : null}
    </Screen>
  );
}
