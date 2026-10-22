/**
 * A deck's study guide. Every sentence the desktop could trace to a slide is
 * tappable: it shows where it came from and the text of that slide. The
 * slide images stay on the desktop — a .meganstudy file carries text only.
 */
import { useState } from "react";

import type { CitedSentence } from "@megan/core/primer/types";

import { useApp } from "../context";
import { citationLabel, loadGuide } from "../data/guides";
import { Empty, Notice, Screen, Sheet, useLoad } from "../components/ui";

function Sentences({ items, onCite }: { items: CitedSentence[]; onCite: (sentence: CitedSentence) => void }) {
  return (
    <p>
      {items.map((sentence, i) => {
        const label = citationLabel(sentence);
        const text = `${sentence.text}${i < items.length - 1 ? " " : ""}`;
        return label ? (
          <button key={i} type="button" className="cite" onClick={() => onCite(sentence)} aria-label={`${sentence.text} (${label})`}>
            {sentence.text}
            <sup aria-hidden>{sentence.source_slide_number}</sup>{" "}
          </button>
        ) : (
          <span key={i}>{text}</span>
        );
      })}
    </p>
  );
}

export function GuideScreen({ examId, title }: { examId: string; title: string }) {
  const { db } = useApp();
  const { data: guide, error } = useLoad(() => loadGuide(db, examId), [examId]);
  const [cited, setCited] = useState<CitedSentence | null>(null);

  return (
    <Screen title={`${title} · Study guide`}>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {guide === null ? <Empty title="No study guide">Make one for this deck in the desktop app, then share the deck again.</Empty> : null}
      {guide ? (
        <article className="stack">
          {guide.overview ? <p className="muted">{guide.overview}</p> : null}
          {guide.topics.map((topic, t) => (
            <section className="guide-topic" key={topic.id ?? t}>
              <h2>{topic.title}</h2>
              {topic.intro ? <p>{topic.intro}</p> : null}
              {topic.sections.map((section) => (
                <div className="guide-section panel" key={section.id}>
                  <h3>{section.conceptName}</h3>
                  {section.definition.length ? <Sentences items={section.definition} onCite={setCited} /> : null}
                  {section.breakdown.length ? (
                    <>
                      <p className="guide-label">Breakdown</p>
                      <Sentences items={section.breakdown} onCite={setCited} />
                    </>
                  ) : null}
                  {section.example.length ? (
                    <>
                      <p className="guide-label">Example</p>
                      <Sentences items={section.example} onCite={setCited} />
                    </>
                  ) : null}
                  {section.counterExample ? (
                    <>
                      <p className="guide-label">Common mistake</p>
                      <p>
                        <strong>{section.counterExample.misconception}</strong>
                      </p>
                      {section.counterExample.incorrectApplication ? <p>{section.counterExample.incorrectApplication}</p> : null}
                      {section.counterExample.whyFlawed ? <p className="muted">{section.counterExample.whyFlawed}</p> : null}
                    </>
                  ) : null}
                </div>
              ))}
            </section>
          ))}
        </article>
      ) : null}

      {cited ? (
        <Sheet title={citationLabel(cited) ?? "Source"} onClose={() => setCited(null)}>
          <div className="stack">
            <p>{cited.text}</p>
            <p className="guide-label">Original slide</p>
            {cited.source_excerpt ? (
              <blockquote className="excerpt">{cited.source_excerpt}</blockquote>
            ) : (
              <p className="muted">The deck didn&apos;t include this slide&apos;s text.</p>
            )}
            <p className="muted small">Slide images stay in the desktop app; open the deck there to see the slide itself.</p>
          </div>
        </Sheet>
      ) : null}
    </Screen>
  );
}
