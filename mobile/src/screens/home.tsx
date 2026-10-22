/** Home: what is due, one tap to start, and every course and deck. */
import { Camera, FileDown, FilePlus2, GraduationCap, Library, Mic } from "lucide-react";
import { useState } from "react";

import { SHARE_EXTENSION } from "@megan/core/share/meganstudy";

import { useApp } from "../context";
import { countAllDue, listCourses } from "../data/decks";
import { importShareFile } from "../data/import";
import { ensureSampleDeck } from "../data/sample";
import { Button, Empty, Notice, Screen, plural, useLoad } from "../components/ui";

import { errorText } from "./source";

export function HomeScreen() {
  const { db, platform, navigate, changed } = useApp();
  const { data, error } = useLoad(async () => ({ due: await countAllDue(db), courses: await listCourses(db) }), []);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  async function importDeck() {
    setMessage(null);
    try {
      const [file] = await platform.files.pickFiles({ accept: [SHARE_EXTENSION, "application/json"] });
      if (!file) return;
      const deck = await importShareFile(db, new TextDecoder().decode(file.bytes));
      changed();
      setMessage({ tone: "info", text: `Added “${deck.title}” — ${plural(deck.cards, "card")}.` });
      navigate({ name: "deck", examId: deck.examId });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function openSample() {
    const examId = await ensureSampleDeck(db);
    changed();
    navigate({ name: "deck", examId });
  }

  const decks = data?.courses.flatMap((course) => course.decks) ?? [];

  return (
    <Screen title="Home" back={false}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {data ? (
        <div className="hero">
          <h2>{data.due > 0 ? `${plural(data.due, "card")} due` : "You're caught up"}</h2>
          <p>{data.due > 0 ? "A few minutes now keeps them from piling up." : "Nothing is due. Learn something new, or review a deck."}</p>
          {data.due > 0 ? (
            <Button onClick={() => navigate({ name: "cards", source: { kind: "due" }, title: "Due today", swipe: true })}>
              Study now
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid-actions">
        <button type="button" className="action" onClick={() => navigate({ name: "make" })}>
          <FilePlus2 aria-hidden />
          <strong>Make a deck</strong>
          <span>From slides, a PDF, notes or Quizlet</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "snap" })}>
          <Camera aria-hidden />
          <strong>Snap your notes</strong>
          <span>Photos into flashcards</span>
        </button>
        <button type="button" className="action" onClick={importDeck}>
          <FileDown aria-hidden />
          <strong>Open a deck</strong>
          <span>A {SHARE_EXTENSION} file from a friend</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "catalog" })}>
          <Library aria-hidden />
          <strong>Catalog</strong>
          <span>Decks other students shared</span>
        </button>
        <button type="button" className="action" onClick={() => navigate({ name: "lectures" })}>
          <Mic aria-hidden />
          <strong>Record a lecture</strong>
          <span>Keeps going with the screen off</span>
        </button>
      </div>

      {data && decks.length === 0 ? (
        <Empty title="No decks yet">
          <p>Make a deck from your slides or notes, open one a friend shared, or try the sample.</p>
          <Button onClick={openSample}>Try the sample deck</Button>
        </Empty>
      ) : null}

      {data?.courses
        .filter((course) => course.decks.length > 0)
        .map((course) => (
          <div className="section" key={course.courseId}>
            <h2 className="section-title">
              {course.title}
              {course.term ? <span className="muted small"> · {course.term}</span> : null}
            </h2>
            <div className="list">
              {course.decks.map((deck) => (
                <button type="button" className="row" key={deck.examId} onClick={() => navigate({ name: "deck", examId: deck.examId })}>
                  <GraduationCap aria-hidden />
                  <span className="row-main">
                    <span className="row-title">{deck.title}</span>
                    <span className="row-sub">
                      {plural(deck.cardCount, "card")}
                      {deck.newCount > 0 ? ` · ${deck.newCount} new` : ""}
                    </span>
                  </span>
                  {deck.dueCount > 0 ? <span className="pill pill-accent">{deck.dueCount} due</span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}

      {data && decks.length > 0 ? (
        <Button variant="ghost" onClick={openSample}>
          Open the sample deck
        </Button>
      ) : null}
    </Screen>
  );
}
