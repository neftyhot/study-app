/**
 * Anki `.apkg` writer.
 *
 * An apkg is a zip holding `collection.anki2` — a SQLite database in Anki's
 * schema 11 — plus numbered media files and a `media` manifest mapping those
 * numbers back to filenames. Anki 2.1 still imports schema 11, and writing it
 * directly means no dependency that would have to be trusted with the whole
 * deck.
 *
 * The database is built with the same better-sqlite3 the app already uses, in
 * a temporary file that is removed once its bytes have been read.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import JSZip from "jszip";

import type { DeckExport, ExportCard } from "./cards";

/** Anki's schema 11, which current Anki still accepts on import. */
const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null, usn integer not null,
  ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
  mod integer not null, usn integer not null, tags text not null, flds text not null,
  sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
  ord integer not null, mod integer not null, usn integer not null, type integer not null,
  queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
  ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null,
  time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

const CSS = `.card {
  font-family: -apple-system, system-ui, sans-serif;
  font-size: 19px;
  text-align: left;
  color: #18181b;
  background: #ffffff;
  padding: 1.2em;
}
.rubric { font-size: 0.85em; color: #52525b; margin-top: 0.8em; }
.source { font-size: 0.78em; color: #71717a; margin-top: 0.8em; }
img { max-width: 100%; }`;

/** Anki fields are HTML fragments, so text has to arrive escaped. */
export function ankiField(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** Anki splits tags on whitespace, so a tag can never contain any. */
export function ankiTag(value: string): string {
  return value
    .trim()
    .replace(/["\s]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

/** Anki's duplicate check: the low 32 bits of the first field's SHA-1. */
export function fieldChecksum(value: string): number {
  const stripped = value.replace(/<[^>]+>/g, "");
  return parseInt(
    createHash("sha1").update(stripped, "utf8").digest("hex").slice(0, 8),
    16,
  );
}

/** The Back of the card: answer, then explanation, then what it must contain. */
export function backField(card: ExportCard, imageName: string | null): string {
  const parts = [`<div class="answer">${ankiField(card.directAnswer)}</div>`];

  if (card.fullExplanation) {
    parts.push(`<div class="explanation">${ankiField(card.fullExplanation)}</div>`);
  }

  if (card.essentialPoints.length > 0) {
    const items = card.essentialPoints
      .map((point) => `<li>${ankiField(point)}</li>`)
      .join("");
    parts.push(`<div class="rubric">Must include:<ul>${items}</ul></div>`);
  }

  if (imageName) {
    // Anki resolves a bare filename against its own media folder.
    parts.push(`<img src="${imageName}">`);
  }

  if (card.sourceLabel) {
    parts.push(`<div class="source">${ankiField(card.sourceLabel)}</div>`);
  }

  return parts.join("");
}

function models(modelId: number, deckId: number, name: string) {
  return {
    [modelId]: {
      id: modelId,
      name,
      type: 0,
      mod: Math.floor(Date.now() / 1000),
      usn: -1,
      sortf: 0,
      did: deckId,
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
          did: null,
          bqfmt: "",
          bafmt: "",
        },
      ],
      flds: [
        { name: "Front", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
        { name: "Back", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      ],
      css: CSS,
      latexPre:
        "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
      latexPost: "\\end{document}",
      latexsvg: false,
      req: [[0, "any", [0]]],
      tags: [],
      vers: [],
    },
  };
}

function decks(deckId: number, name: string) {
  return {
    1: {
      id: 1,
      name: "Default",
      mod: 0,
      usn: 0,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: true,
      browserCollapsed: true,
      desc: "",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
    [deckId]: {
      id: deckId,
      // Anki reads "::" in a deck name as nesting, so it must not survive here.
      name: name.replace(/::/g, "-"),
      mod: Math.floor(Date.now() / 1000),
      usn: -1,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      desc: "Exported from Study App.",
      dyn: 0,
      conf: 1,
      extendNew: 10,
      extendRev: 50,
    },
  };
}

const DCONF = {
  1: {
    id: 1,
    name: "Default",
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20 },
    rev: { bury: false, ease4: 1.3, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
    dyn: false,
  },
};

export type ApkgMedia = {
  /** Filename Anki will store it under, referenced from the Back field. */
  name: string;
  data: Buffer;
};

export type ApkgOptions = {
  /** Slide images to embed, keyed by card id. */
  media?: Map<string, ApkgMedia>;
};

export async function buildApkg(
  deck: DeckExport,
  options: ApkgOptions = {},
): Promise<Buffer> {
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);
  const deckId = now;
  const modelId = now + 1;

  const path = join(tmpdir(), `study-app-anki-${randomUUID()}.anki2`);
  const media = options.media ?? new Map<string, ApkgMedia>();
  const manifest: Record<string, string> = {};
  const zip = new JSZip();

  const sqlite = new Database(path);
  try {
    sqlite.exec(SCHEMA);

    sqlite
      .prepare(
        `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`,
      )
      .run(
        // crt is the collection's day boundary, in seconds.
        nowSec,
        now,
        now,
        JSON.stringify({
          nextPos: 1,
          estTimes: true,
          activeDecks: [1],
          sortType: "noteFld",
          timeLim: 0,
          sortBackwards: false,
          addToCur: true,
          curDeck: 1,
          newBury: true,
          newSpread: 0,
          dueCounter: 1,
          curModel: String(modelId),
          collapseTime: 1200,
        }),
        JSON.stringify(models(modelId, deckId, `${deck.title} — Study App`)),
        JSON.stringify(decks(deckId, deck.title)),
        JSON.stringify(DCONF),
      );

    const insertNote = sqlite.prepare(
      `INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`,
    );
    const insertCard = sqlite.prepare(
      `INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
    );

    const write = sqlite.transaction(() => {
      deck.cards.forEach((card, i) => {
        const noteId = now + i * 2;
        const cardId = now + i * 2 + 1;

        const attachment = media.get(card.id);
        if (attachment) {
          const slot = String(Object.keys(manifest).length);
          manifest[slot] = attachment.name;
          zip.file(slot, attachment.data);
        }

        const front = ankiField(card.question);
        const back = backField(card, attachment?.name ?? null);

        const tags = [
          ankiTag(deck.title),
          ankiTag(card.topic),
          card.professorEmphasis ? "professor_emphasis" : "",
        ].filter(Boolean);

        insertNote.run(
          noteId,
          randomUUID().replace(/-/g, "").slice(0, 10),
          modelId,
          nowSec,
          // Anki's tag field is space-delimited and space-padded.
          ` ${tags.join(" ")} `,
          // Fields are joined by the unit separator, U+001F.
          `${front}\u001f${back}`,
          front,
          fieldChecksum(front),
        );

        // due = the card's position in the new queue, which is 1-based.
        insertCard.run(cardId, noteId, deckId, nowSec, i + 1);
      });
    });

    write();
  } finally {
    sqlite.close();
  }

  const collection = await readFile(path);
  await rm(path, { force: true });

  zip.file("collection.anki2", collection);
  zip.file("media", JSON.stringify(manifest));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
