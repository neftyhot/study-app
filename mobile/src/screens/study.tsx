/** Study: the quickest ways into a session — what's due, what's starred, any deck. */
import { CalendarClock, Star } from "lucide-react";

import { useApp } from "../context";
import { countAllDue, listCourses } from "../data/decks";
import { Empty, Notice, Screen, plural, useLoad } from "../components/ui";

export function StudyScreen() {
  const { db, navigate } = useApp();
  const { data, error } = useLoad(async () => {
    const courses = await listCourses(db);
    const decks = courses.flatMap((course) => course.decks);
    return { due: await countAllDue(db), starred: decks.reduce((sum, deck) => sum + deck.starredCount, 0), decks };
  }, []);

  return (
    <Screen title="Study" back={false}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {data ? (
        <>
          <div className="list">
            <button
              type="button"
              className="row"
              disabled={data.due === 0}
              onClick={() => navigate({ name: "cards", source: { kind: "due" }, title: "Due today", swipe: true })}
            >
              <CalendarClock aria-hidden />
              <span className="row-main">
                <span className="row-title">Due today</span>
                <span className="row-sub">{data.due > 0 ? `${plural(data.due, "card")}, every deck` : "Nothing due"}</span>
              </span>
            </button>
            <button
              type="button"
              className="row"
              disabled={data.starred === 0}
              onClick={() => navigate({ name: "cards", source: { kind: "starred" }, title: "Starred" })}
            >
              <Star aria-hidden />
              <span className="row-main">
                <span className="row-title">Starred</span>
                <span className="row-sub">{data.starred > 0 ? plural(data.starred, "card") : "Star cards to collect them here"}</span>
              </span>
            </button>
          </div>

          <div className="section">
            <h2 className="section-title">Decks</h2>
            {data.decks.length === 0 ? (
              <Empty title="No decks yet">Open one from Home.</Empty>
            ) : (
              <div className="list">
                {data.decks.map((deck) => (
                  <button type="button" className="row" key={deck.examId} onClick={() => navigate({ name: "deck", examId: deck.examId })}>
                    <span className="row-main">
                      <span className="row-title">{deck.title}</span>
                      <span className="row-sub">{plural(deck.cardCount, "card")}</span>
                    </span>
                    {deck.dueCount > 0 ? <span className="pill pill-accent">{deck.dueCount} due</span> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </Screen>
  );
}
