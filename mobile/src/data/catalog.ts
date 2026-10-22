/**
 * The shared deck catalog on the phone: the iOS twin of the desktop's
 * `src/lib/catalog/store.ts`. Listings live on the app's server, so the
 * phone, the Mac and Windows all see the same catalog. Requests go through
 * the native HTTP stack (no CORS), as this install, with the same
 * `X-Install-Id` header the desktop sends, so a listing shared from this
 * phone can be edited or removed from it.
 */
import { CapacitorHttp } from "@capacitor/core";

import type { CatalogDeck, CatalogDeckDetail, CatalogKind, PublishInput } from "@megan/core/catalog/types";
import type { DeckCard, DeckGuide } from "@megan/core/decks/types";
import type { SqlDriver } from "@megan/core/platform/types";

import { buildShareFile } from "./export";
import { insertDeck } from "./import";
import { readSetting, writeSetting } from "./settings";

export class CatalogError extends Error {}

const OFFLINE = "Can't reach the catalog right now. Check your connection and try again.";

export type HttpRequest = { url: string; method: string; headers: Record<string, string>; body?: unknown; timeoutMs: number };
export type HttpResponse = { status: number; data: unknown };
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

const nativeHttp: Http = async ({ url, method, headers, body, timeoutMs }) => {
  const response = await CapacitorHttp.request({
    url,
    method,
    headers,
    data: body,
    responseType: "json",
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  });
  return { status: response.status, data: typeof response.data === "string" ? safeJson(response.data) : response.data };
};

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const builtInServer = () => (typeof __SERVER_URL__ === "string" ? __SERVER_URL__ : "");

/** The same per-install id the desktop keeps under `install_id`. */
async function installId(db: SqlDriver): Promise<string> {
  const saved = await readSetting(db, "install_id");
  if (saved) return saved;
  const id = crypto.randomUUID();
  await writeSetting(db, "install_id", id);
  return id;
}

export type CatalogClient = ReturnType<typeof catalogClient>;

/** `http` and `server` are for the tests; the app uses the native stack and the built-in address. */
export function catalogClient(db: SqlDriver, http: Http = nativeHttp, server: string = builtInServer()) {
  async function remote<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    if (!server) throw new CatalogError("The catalog isn't available in this build.");
    let response: HttpResponse;
    try {
      response = await http({
        url: `${server}${path}`,
        method,
        headers: { "Content-Type": "application/json", "X-Install-Id": await installId(db) },
        body,
        // Sharing waits on the content check, so it gets longer than a read.
        timeoutMs: method === "GET" ? 10_000 : 45_000,
      });
    } catch {
      throw new CatalogError(OFFLINE);
    }
    const data = response.data as (T & { error?: string }) | null;
    if (response.status < 200 || response.status >= 300 || !data || typeof data !== "object") {
      throw new CatalogError(data?.error ?? (response.status >= 500 ? OFFLINE : "The catalog couldn't do that."));
    }
    return data;
  }

  const at = (id: string) => `/catalog/${encodeURIComponent(id)}`;

  return {
    available: Boolean(server),

    async list(): Promise<{ decks: CatalogDeck[]; offline: string | null }> {
      try {
        const { decks } = await remote<{ decks: CatalogDeck[] }>("/catalog");
        return { decks: Array.isArray(decks) ? decks : [], offline: null };
      } catch (error) {
        if (error instanceof CatalogError) return { decks: [], offline: error.message };
        throw error;
      }
    },

    get: (id: string) => remote<CatalogDeckDetail>(at(id)),

    /** Copies a shared deck into a new deck of the student's own; returns its exam id. */
    async add(id: string): Promise<string> {
      const row = await remote<{ title: string; course: string; term: string | null; cards: DeckCard[]; guide: DeckGuide | null }>(
        `${at(id)}/add`,
        "POST",
      );
      if (!Array.isArray(row.cards) || row.cards.length === 0) throw new CatalogError("That deck has no cards.");
      return insertDeck(db, { title: row.title, course: row.course, term: row.term, cards: row.cards, guide: row.guide, origin: "catalog" });
    },

    async report(id: string, reason: string | null) {
      await remote(`${at(id)}/report`, "POST", { reason: clean(reason) });
    },

    /** Shares one of the student's decks; `moderationKey` is their own Gemini key, used once by the server. */
    async publish(input: PublishInput, moderationKey: string | null): Promise<CatalogDeck> {
      if (input.attested !== true) throw new CatalogError("Confirm that you made these cards yourself before sharing.");
      checkDetails(input);
      if (!moderationKey) throw new CatalogError(NO_MODERATION_KEY);
      const file = await buildShareFile(db, input.examId, { includeGuide: input.includeGuide });
      if (!file || file.deck.cards.length === 0) throw new CatalogError("That deck has no cards to share.");
      return remote<CatalogDeck>("/catalog", "POST", {
        ...detailsBody(input),
        uploader: clean(input.uploader) ?? "A student",
        sourceExamId: input.examId,
        cards: file.deck.cards,
        guide: input.includeGuide ? file.deck.guide : null,
        moderation: { provider: "gemini", key: moderationKey },
      });
    },

    async update(id: string, fields: Details, moderationKey: string | null): Promise<CatalogDeck> {
      checkDetails(fields);
      if (!moderationKey) throw new CatalogError(NO_MODERATION_KEY);
      return remote<CatalogDeck>(at(id), "PATCH", { ...detailsBody(fields), moderation: { provider: "gemini", key: moderationKey } });
    },

    async remove(id: string) {
      await remote(at(id), "DELETE");
    },
  };
}

export const NO_MODERATION_KEY =
  "Sharing needs your AI key: the catalog checks each deck with it before listing it. Add one in Settings.";

const KINDS: CatalogKind[] = ["exam", "quiz", "test", "module", "assignment", "custom"];

export type Details = Pick<PublishInput, "title" | "college" | "professor" | "course" | "kind" | "customKind" | "term" | "description">;

const clean = (s: string | null | undefined) => s?.trim() || null;

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

const COLLEGE_SETTING = "catalog_college";

export async function readCollege(db: SqlDriver): Promise<string | null> {
  return (await readSetting(db, COLLEGE_SETTING))?.trim() || null;
}

export async function writeCollege(db: SqlDriver, college: string): Promise<string> {
  const value = college.trim().replace(/\s+/g, " ");
  if (!value) throw new CatalogError("Enter your college.");
  if (value.length > 120) throw new CatalogError("That college name is too long.");
  await writeSetting(db, COLLEGE_SETTING, value);
  return value;
}

/** Search and filters, as on the desktop: every word must match somewhere in the listing. */
export function filterDecks(
  decks: CatalogDeck[],
  filter: { query: string; college: string; onlyMine: boolean },
): CatalogDeck[] {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  return decks.filter((deck) => {
    if (filter.onlyMine && !deck.mine) return false;
    if (filter.college && deck.college.toLowerCase() !== filter.college.toLowerCase()) return false;
    const haystack = [deck.title, deck.college, deck.professor, deck.course, deck.term, deck.description, deck.customKind, deck.kind]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}
