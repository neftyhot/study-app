/**
 * The shared deck catalog, by college, professor, course and exam.
 *
 * Listings live on the app's server (workers/licensing/src/catalog.ts), which
 * checks every share with a content model before it's listed and limits how
 * often anyone can share. A shared deck is a snapshot of its cards and study
 * guide (no slides or slide citations, which are the professor's material),
 * and adding one copies that snapshot into a new deck of the student's own.
 * Nothing is listed until the student shares it, and only the install that
 * shared a listing can change or remove it.
 */
import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { serverUrl } from "@/lib/app-info";
import { readApiKey, readProvider, readSetting, writeSetting } from "@/lib/settings";
import { installId } from "@/lib/telemetry";
import { courses, exams } from "@/db/schema";
import { insertDeck, type DeckCard, type DeckGuide } from "@/lib/decks/insert";
import { snapshotCards, snapshotGuide } from "@/lib/decks/snapshot";

import type { CatalogDeck, CatalogDeckDetail, CatalogKind, PublishInput } from "./types";

export class CatalogError extends Error {}

const OFFLINE = "Can't reach the catalog right now. Check your connection and try again.";

/** Calls the catalog server as this install; throws CatalogError with its message. */
async function remote<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = serverUrl();
  if (!base) throw new CatalogError("The catalog isn't available in this build.");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      cache: "no-store",
      // Sharing waits on the content check, so it gets longer than a read.
      signal: AbortSignal.timeout(init.method && init.method !== "GET" ? 45_000 : 10_000),
      headers: { "Content-Type": "application/json", "X-Install-Id": installId(db), ...init.headers },
    });
  } catch {
    throw new CatalogError(OFFLINE);
  }
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) {
    throw new CatalogError(body?.error ?? (response.status >= 500 ? OFFLINE : "The catalog couldn't do that."));
  }
  return body;
}

/** Everything listed, plus this install's own hidden listings; `offline` says why when the server can't be reached. */
export async function listCatalog(): Promise<{ decks: CatalogDeck[]; offline: string | null }> {
  try {
    const { decks } = await remote<{ decks: CatalogDeck[] }>("/catalog");
    // A reply of the wrong shape would otherwise take the whole page down.
    return { decks: Array.isArray(decks) ? decks : [], offline: null };
  } catch (error) {
    if (error instanceof CatalogError) return { decks: [], offline: error.message };
    throw error;
  }
}

export async function getCatalogDeck(id: string): Promise<CatalogDeckDetail> {
  return remote<CatalogDeckDetail>(`/catalog/${encodeURIComponent(id)}`);
}

/** The student's own decks, to pick one to publish. */
export function listOwnDecks() {
  return db
    .select({ examId: exams.id, examTitle: exams.title, courseTitle: courses.title, term: courses.term })
    .from(exams)
    .innerJoin(courses, eq(courses.id, exams.courseId))
    .orderBy(asc(courses.title), asc(exams.title))
    .all();
}

const KINDS: CatalogKind[] = ["exam", "quiz", "test", "module", "assignment", "custom"];

type Details = Pick<PublishInput, "title" | "college" | "professor" | "course" | "kind" | "customKind" | "term" | "description">;

const clean = (s: string | null | undefined) => s?.trim() || null;

/** Catches missing fields here, before anything is sent. */
function checkDetails(input: Details) {
  if (!clean(input.college)) throw new CatalogError("Enter the college.");
  if (!clean(input.professor)) throw new CatalogError("Enter the professor.");
  if (!clean(input.course)) throw new CatalogError("Enter the course.");
  if (!clean(input.title)) throw new CatalogError("Give the deck a title.");
  if (!KINDS.includes(input.kind)) throw new CatalogError("Pick what the deck is for.");
  if (input.kind === "custom" && !clean(input.customKind)) throw new CatalogError("Name the custom type.");
}

const detailsBody = (fields: Details) => ({
  title: clean(fields.title),
  college: clean(fields.college),
  professor: clean(fields.professor),
  course: clean(fields.course),
  kind: fields.kind,
  customKind: fields.kind === "custom" ? clean(fields.customKind) : null,
  term: clean(fields.term),
  description: clean(fields.description),
});

type ModerationProvider = "gemini" | "anthropic" | "openai";

export const NO_MODERATION_KEY =
  "Sharing needs a Gemini, Claude or OpenAI API key in Settings: the catalog checks each deck with it before listing it. Local models can't run the check.";

/**
 * The student's own key, sent with a share so the catalog can check the deck
 * on their account: the provider they answer with if it has a key, else the
 * first key they have saved. The catalog uses it once and keeps nothing.
 */
function moderationKey(): { provider: ModerationProvider; key: string } {
  const chosen = readProvider();
  const order: ModerationProvider[] = ["gemini", "anthropic", "openai"];
  if (chosen !== "local") order.unshift(chosen);
  for (const provider of order) {
    const key = readApiKey(provider);
    if (key) return { provider, key };
  }
  throw new CatalogError(NO_MODERATION_KEY);
}

export async function publishDeck(input: PublishInput): Promise<CatalogDeck> {
  checkDetails(input);
  const cards = snapshotCards(db, input.examId);
  if (cards.length === 0) throw new CatalogError("That deck has no cards to share.");
  const guide = input.includeGuide ? snapshotGuide(db, input.examId) : null;
  const moderation = moderationKey();
  return remote<CatalogDeck>("/catalog", {
    method: "POST",
    body: JSON.stringify({
      ...detailsBody(input),
      uploader: clean(input.uploader) ?? "A student",
      sourceExamId: input.examId,
      cards,
      guide,
      moderation,
    }),
  });
}

export async function updateListing(id: string, fields: Details): Promise<CatalogDeck> {
  checkDetails(fields);
  return remote<CatalogDeck>(`/catalog/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...detailsBody(fields), moderation: moderationKey() }),
  });
}

export async function removeListing(id: string) {
  await remote(`/catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function reportListing(id: string, reason: string | null) {
  await remote(`/catalog/${encodeURIComponent(id)}/report`, {
    method: "POST",
    body: JSON.stringify({ reason: clean(reason) }),
  });
}

const COLLEGE_SETTING = "catalog_college";

/** The student's current college, asked for the first time the catalog opens. */
export function readCollege(): string | null {
  return readSetting(COLLEGE_SETTING)?.trim() || null;
}

export function writeCollege(college: string): string {
  const value = college.trim().replace(/\s+/g, " ");
  if (!value) throw new CatalogError("Enter your college.");
  if (value.length > 120) throw new CatalogError("That college name is too long.");
  writeSetting(COLLEGE_SETTING, value);
  return value;
}

/** Copies a shared deck into a new deck of the student's own; returns its exam id. */
export async function addToMyDecks(id: string): Promise<string> {
  const row = await remote<{
    title: string;
    course: string;
    term: string | null;
    cards: DeckCard[];
    guide: DeckGuide | null;
  }>(`/catalog/${encodeURIComponent(id)}/add`, { method: "POST" });
  if (row.cards.length === 0) throw new CatalogError("That deck has no cards.");
  const examId = insertDeck(db, {
    title: row.title,
    course: row.course,
    term: row.term,
    cards: row.cards,
    guide: row.guide,
    origin: "catalog",
  });

  return examId;
}
