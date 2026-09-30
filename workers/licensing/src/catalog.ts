/**
 * The shared deck catalog, kept in D1 (migrations/0001_catalog.sql):
 *
 *   GET    /catalog              Live listings, newest first, plus the
 *                                caller's own hidden ones.
 *   GET    /catalog/:id          One listing with a preview of its cards.
 *   POST   /catalog              Share a deck. Checked by an AI model first,
 *                                on the sharer's own key; a deck it flags
 *                                or declines is never listed.
 *   PATCH  /catalog/:id          Edit a listing's details (owner only;
 *                                the new text is checked again).
 *   DELETE /catalog/:id          Remove a listing (owner only).
 *   POST   /catalog/:id/add      The whole snapshot, to copy into the app.
 *   POST   /catalog/:id/report   Flag a listing; enough reports hide it.
 *
 *   GET    /admin/catalog        Listings for review (?status=hidden).
 *   POST   /admin/catalog/:id/hide | restore | ban,  DELETE /admin/catalog/:id
 *   PUT    /admin/catalog/settings   { publishing: false } stops new shares.
 *
 * The caller is its install id, sent as X-Install-Id: a random UUID only the
 * install and this server know, so it doubles as the owner's secret. It is
 * never returned to anyone.
 *
 * The check runs on the sharer's own API key (Gemini, Claude or OpenAI),
 * sent with the share as `moderation: { provider, key }`, with the same
 * instructions whichever provider it is. The key is used for that one call
 * and is never stored, logged or returned. Nothing reaches the provider
 * until a request is well formed, under its size caps, not a duplicate of a
 * listed deck, and inside the rate limits (per install and per network). A
 * cheap local check turns away the obvious first, and every verdict
 * is kept by the hash of what was checked, so sending the same deck again
 * costs nothing and gets the same answer. Anything that goes wrong with the
 * check itself refuses the share: the catalog fails closed.
 */
import { authorized, type InsightsEnv } from "./insights";

export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type D1Like = { prepare(sql: string): D1Statement };

export type CatalogEnv = InsightsEnv & {
  CATALOG?: D1Like;
};

/**
 * The model each provider's check runs on: a capable one, not the smallest,
 * so a verdict is rarely wrong, but cheap enough that sharing costs the
 * student a fraction of a cent.
 */
export const MODERATION_MODELS = {
  gemini: "gemini-3.7-flash",
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-6-luna",
} as const;

export type ModerationProvider = keyof typeof MODERATION_MODELS;

/** The sharer's own key, used for their check and then forgotten. */
export type Moderator = { provider: ModerationProvider; key: string };

const PROVIDER_NAMES: Record<ModerationProvider, string> = {
  gemini: "Gemini",
  anthropic: "Claude",
  openai: "OpenAI",
};

export const CATALOG_KINDS = ["exam", "quiz", "test", "module", "assignment", "custom"] as const;

export const LIMITS = {
  bodyBytes: 800_000,
  /** Everything the check would read; a bigger deck is refused, not half-checked. */
  moderationChars: 400_000,
  minCards: 3,
  maxCards: 500,
  guideTopics: 60,
  guideSections: 400,
  /** Listings one install may have at once. */
  listingsPerOwner: 30,
  publishPerHour: 4,
  publishPerDay: 10,
  /** From one network, whatever install ids it uses. */
  publishPerDayPerIp: 20,
  editsPerDay: 20,
  /** From one network, whatever install ids it uses. */
  editsPerDayPerIp: 60,
  /** Refusals in a day before that install may not share until tomorrow. */
  rejectionsPerDay: 3,
  reportsPerDay: 20,
  /** From one network, whatever install ids it uses. */
  reportsPerDayPerIp: 40,
  reportsToHide: 3,
} as const;

const FIELD_MAX = {
  title: 120,
  college: 120,
  professor: 80,
  course: 120,
  customKind: 40,
  term: 40,
  description: 1000,
  uploader: 40,
} as const;

const CARD_MAX = { topic: 200, question: 2000, answer: 2000, explanation: 4000, excerpt: 2000, point: 500, points: 12 };
const GUIDE_MAX = { overview: 4000, title: 200, intro: 2000, concept: 200, sentence: 2000, sentences: 20 };

const INSTALL_ID = /^[a-f0-9-]{16,64}$/i;
const DECK_ID = /^[a-f0-9-]{36}$/i;
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const SETTINGS_KEY = "catalog:settings";

type CardSnapshot = {
  topic: string | null;
  question: string;
  directAnswer: string;
  fullExplanation: string | null;
  cardType: string;
  sourceExcerpt: string | null;
  essentialPoints: string[];
};

type SectionSnapshot = { conceptName: string; definition: string[]; breakdown: string[]; example: string[] };
type GuideSnapshot = { overview: string | null; topics: { title: string; intro: string; sections: SectionSnapshot[] }[] };

type Details = {
  title: string;
  college: string;
  professor: string;
  course: string;
  kind: (typeof CATALOG_KINDS)[number];
  customKind: string | null;
  term: string | null;
  description: string | null;
  uploader: string;
};

type Row = {
  id: string;
  owner: string;
  title: string;
  college: string;
  professor: string;
  course: string;
  kind: string;
  custom_kind: string | null;
  term: string | null;
  description: string | null;
  uploader: string;
  card_count: number;
  section_count: number;
  adds: number;
  status: string;
  source_exam_id: string | null;
  created_at: string;
};

const LIST_COLUMNS = `id, owner, title, college, professor, course, kind, custom_kind, term, description,
  uploader, card_count, section_count, adds, status, source_exam_id, created_at`;

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/* ---------------------------------------------------------------- Routing */

export async function handleCatalog(request: Request, env: CatalogEnv, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/catalog" && !path.startsWith("/catalog/") && !path.startsWith("/admin/catalog")) return null;

  try {
    if (path.startsWith("/admin/catalog")) {
      if (!authorized(request, env)) return new Response("Unauthorized", { status: 401 });
      return await handleAdminCatalog(request, env, path);
    }

    const db = env.CATALOG;
    if (!db) throw new Refusal(503, "The catalog is not available right now.");
    const me = requester(request);
    const [, , id, action] = path.split("/");

    if (path === "/catalog") {
      if (request.method === "GET") return await list(db, me);
      if (request.method === "POST") return await publish(request, env, db, need(me));
    } else if (id && DECK_ID.test(id)) {
      if (!action && request.method === "GET") return await detail(db, id, me);
      if (!action && request.method === "PATCH") return await edit(request, env, db, id, need(me));
      if (!action && request.method === "DELETE") return await remove(db, id, need(me));
      if (action === "add" && request.method === "POST") return await add(db, id, need(me));
      if (action === "report" && request.method === "POST") return await report(request, db, id, need(me));
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    if (error instanceof Refusal) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
            ...(error.retryAfter ? { "Retry-After": String(Math.ceil(error.retryAfter / 1000)) } : {}),
          },
        },
      );
    }
    console.error("[catalog]", error);
    return Response.json({ error: "The catalog hit a problem. Try again in a minute." }, { status: 500 });
  }
}

function requester(request: Request): string | null {
  const id = request.headers.get("x-install-id")?.trim() ?? "";
  return INSTALL_ID.test(id) ? id.toLowerCase() : null;
}

function need(me: string | null): string {
  if (!me) throw new Refusal(400, "Missing install id.");
  return me;
}

const ok = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/* ---------------------------------------------------------------- Reading */

function toDeck(row: Row, me: string | null) {
  const mine = me !== null && row.owner === me;
  return {
    id: row.id,
    title: row.title,
    college: row.college,
    professor: row.professor,
    course: row.course,
    kind: row.kind,
    customKind: row.custom_kind,
    term: row.term,
    description: row.description,
    uploader: row.uploader,
    cardCount: row.card_count,
    sectionCount: row.section_count,
    adds: row.adds,
    status: row.status === "live" ? "live" : "hidden",
    // Which of the owner's own decks it came from; nobody else's business.
    sourceExamId: mine ? row.source_exam_id : null,
    createdAt: row.created_at,
    mine,
  };
}

async function list(db: D1Like, me: string | null) {
  const { results } = await db
    .prepare(
      `SELECT ${LIST_COLUMNS} FROM catalog_decks WHERE status = 'live' OR owner = ?
       ORDER BY created_at DESC LIMIT 2000`,
    )
    .bind(me ?? "")
    .all<Row>();
  return ok({ decks: results.map((row) => toDeck(row, me)) });
}

async function visibleRow<T extends Row>(db: D1Like, id: string, me: string | null, columns = LIST_COLUMNS) {
  const row = await db.prepare(`SELECT ${columns} FROM catalog_decks WHERE id = ?`).bind(id).first<T>();
  if (!row || (row.status !== "live" && row.owner !== me)) {
    throw new Refusal(404, "That deck is no longer in the catalog.");
  }
  return row;
}

async function detail(db: D1Like, id: string, me: string | null) {
  const row = await visibleRow<Row & { cards_json: string; guide_json: string | null }>(
    db,
    id,
    me,
    `${LIST_COLUMNS}, cards_json, guide_json`,
  );
  const cards = JSON.parse(row.cards_json) as CardSnapshot[];
  const guide = row.guide_json ? (JSON.parse(row.guide_json) as GuideSnapshot) : null;
  return ok({
    ...toDeck(row, me),
    sampleCards: cards.slice(0, 8).map((c) => ({ question: c.question, answer: c.directAnswer, topic: c.topic })),
    topics: (guide?.topics ?? []).map((t) => ({ title: t.title, concepts: t.sections.map((s) => s.conceptName) })),
    overview: guide?.overview ?? null,
  });
}

async function add(db: D1Like, id: string, me: string) {
  const row = await visibleRow<Row & { cards_json: string; guide_json: string | null }>(
    db,
    id,
    me,
    `${LIST_COLUMNS}, cards_json, guide_json`,
  );
  // Counted once per install, and never for the owner's own deck.
  if (row.owner !== me) {
    const { meta } = await db
      .prepare(`INSERT OR IGNORE INTO catalog_adds (deck_id, installer) VALUES (?, ?)`)
      .bind(id, me)
      .run();
    if (meta.changes > 0) await db.prepare(`UPDATE catalog_decks SET adds = adds + 1 WHERE id = ?`).bind(id).run();
  }
  return ok({
    title: row.title,
    course: row.course,
    term: row.term,
    cards: JSON.parse(row.cards_json) as CardSnapshot[],
    guide: row.guide_json ? (JSON.parse(row.guide_json) as GuideSnapshot) : null,
  });
}

/* ---------------------------------------------------------------- Sharing */

async function publish(request: Request, env: CatalogEnv, db: D1Like, me: string) {
  await sharingOpen(env);
  await notBanned(db, me);
  const body = await readBody(request);
  const moderator = moderatorOf(body);

  const details = cleanDetails(body);
  const cards = cleanCards(body.cards);
  const guide = cleanGuide(body.guide);
  const sourceExamId = typeof body.sourceExamId === "string" ? body.sourceExamId.slice(0, 64) : null;
  const sectionCount = guide?.topics.reduce((n, t) => n + t.sections.length, 0) ?? 0;

  const contentHash = await sha256(JSON.stringify({ cards, guide }));
  const duplicate = await db
    .prepare(`SELECT owner FROM catalog_decks WHERE content_hash = ? LIMIT 1`)
    .bind(contentHash)
    .first<{ owner: string }>();
  if (duplicate) {
    throw new Refusal(
      409,
      duplicate.owner === me ? "You've already shared this deck. Edit that listing instead." : "This deck is already in the catalog.",
    );
  }

  const { n: listed } = (await db
    .prepare(`SELECT count(*) AS n FROM catalog_decks WHERE owner = ?`)
    .bind(me)
    .first<{ n: number }>()) ?? { n: 0 };
  if (listed >= LIMITS.listingsPerOwner) {
    throw new Refusal(409, `You can have ${LIMITS.listingsPerOwner} decks in the catalog. Remove one to share another.`);
  }

  const ip = await networkOf(request);
  await withinLimits(db, me, ip, "publish");

  const text = moderationText(details, cards, guide);
  if (text.length > LIMITS.moderationChars) {
    throw new Refusal(413, "That deck is too large to share. Try one with fewer or shorter cards.");
  }
  const verdict = await moderate(db, moderator, text, [me, ip], "publish");
  if (!verdict.allowed) throw new Refusal(422, refusalMessage(verdict.reason));

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO catalog_decks (id, owner, title, college, professor, course, kind, custom_kind, term,
        description, uploader, cards_json, guide_json, card_count, section_count, content_hash,
        source_exam_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      me,
      details.title,
      details.college,
      details.professor,
      details.course,
      details.kind,
      details.customKind,
      details.term,
      details.description,
      details.uploader,
      JSON.stringify(cards),
      guide ? JSON.stringify(guide) : null,
      cards.length,
      sectionCount,
      contentHash,
      sourceExamId,
      now,
      now,
    )
    .run();

  const row = await db.prepare(`SELECT ${LIST_COLUMNS} FROM catalog_decks WHERE id = ?`).bind(id).first<Row>();
  return ok(toDeck(row!, me), 201);
}

async function edit(request: Request, env: CatalogEnv, db: D1Like, id: string, me: string) {
  const row = await owned(db, id, me);
  await notBanned(db, me);
  // The name it was shared under stays unless the edit gives a new one.
  const body = await readBody(request);
  const details = cleanDetails({ uploader: row.uploader, ...body });

  const unchanged =
    details.title === row.title &&
    details.college === row.college &&
    details.professor === row.professor &&
    details.course === row.course &&
    details.kind === row.kind &&
    details.customKind === row.custom_kind &&
    details.term === row.term &&
    details.description === row.description &&
    details.uploader === row.uploader;

  if (!unchanged) {
    await sharingOpen(env);
    const moderator = moderatorOf(body);
    const ip = await networkOf(request);
    await withinLimits(db, me, ip, "edit");
    const verdict = await moderate(db, moderator, detailsText(details), [me, ip], "edit");
    if (!verdict.allowed) throw new Refusal(422, refusalMessage(verdict.reason));

    await db
      .prepare(
        `UPDATE catalog_decks SET title = ?, college = ?, professor = ?, course = ?, kind = ?, custom_kind = ?,
          term = ?, description = ?, uploader = ?, updated_at = ? WHERE id = ? AND owner = ?`,
      )
      .bind(
        details.title,
        details.college,
        details.professor,
        details.course,
        details.kind,
        details.customKind,
        details.term,
        details.description,
        details.uploader,
        new Date().toISOString(),
        id,
        me,
      )
      .run();
  }

  const updated = await db.prepare(`SELECT ${LIST_COLUMNS} FROM catalog_decks WHERE id = ?`).bind(id).first<Row>();
  return ok(toDeck(updated!, me));
}

async function remove(db: D1Like, id: string, me: string) {
  await owned(db, id, me);
  await db.prepare(`DELETE FROM catalog_decks WHERE id = ? AND owner = ?`).bind(id, me).run();
  await db.prepare(`DELETE FROM catalog_reports WHERE deck_id = ?`).bind(id).run();
  await db.prepare(`DELETE FROM catalog_adds WHERE deck_id = ?`).bind(id).run();
  return ok({ ok: true });
}

async function owned(db: D1Like, id: string, me: string) {
  const row = await db.prepare(`SELECT ${LIST_COLUMNS} FROM catalog_decks WHERE id = ?`).bind(id).first<Row>();
  if (!row) throw new Refusal(404, "That deck is no longer in the catalog.");
  if (row.owner !== me) throw new Refusal(403, "Only whoever shared a deck can change it.");
  return row;
}

async function report(request: Request, db: D1Like, id: string, me: string) {
  const row = await visibleRow(db, id, me);
  if (row.owner === me) throw new Refusal(400, "That's your own deck.");

  const since = Date.now() - DAY;
  const { n } = (await db
    .prepare(`SELECT count(*) AS n FROM catalog_reports WHERE reporter = ? AND at > ?`)
    .bind(me, since)
    .first<{ n: number }>()) ?? { n: 0 };
  if (n >= LIMITS.reportsPerDay) throw new Refusal(429, "You've sent a lot of reports today. Thanks — we'll look at them.", DAY);
  const network = await networkOf(request);
  const fromNetwork = await count(db, `SELECT count(*) AS n FROM catalog_reports WHERE network = ? AND at > ?`, network, since);
  if (fromNetwork >= LIMITS.reportsPerDayPerIp) {
    throw new Refusal(429, "A lot of reports have come from this network today. Thanks — we'll look at them.", DAY);
  }

  const body = await readBody(request).catch(() => ({}) as Record<string, unknown>);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;
  await db
    .prepare(`INSERT OR IGNORE INTO catalog_reports (deck_id, reporter, reason, at, network) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, me, reason, Date.now(), network)
    .run();

  const { reports } = (await db
    .prepare(`SELECT count(*) AS reports FROM catalog_reports WHERE deck_id = ?`)
    .bind(id)
    .first<{ reports: number }>()) ?? { reports: 0 };
  if (reports >= LIMITS.reportsToHide) {
    await db.prepare(`UPDATE catalog_decks SET status = 'hidden' WHERE id = ?`).bind(id).run();
  }
  return ok({ ok: true });
}

/* ------------------------------------------------------------- Validation */

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > LIMITS.bodyBytes) throw new Refusal(413, "That deck is too large to share.");
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) throw new Refusal(413, "That deck is too large to share.");
  try {
    const body = JSON.parse(text) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // Falls through.
  }
  throw new Refusal(400, "Bad request.");
}

/** Trimmed, whitespace collapsed, control characters gone; null when empty. */
function tidy(value: unknown, max: number, collapse = true): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  let text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "");
  text = collapse ? text.replace(/\s+/g, " ").trim() : text.trim();
  return text ? text.slice(0, max) : null;
}

function cleanDetails(body: Record<string, unknown>): Details {
  const title = tidy(body.title, FIELD_MAX.title);
  const college = tidy(body.college, FIELD_MAX.college);
  const professor = tidy(body.professor, FIELD_MAX.professor);
  const course = tidy(body.course, FIELD_MAX.course);
  if (!college) throw new Refusal(400, "Enter the college.");
  if (!professor) throw new Refusal(400, "Enter the professor.");
  if (!course) throw new Refusal(400, "Enter the course.");
  if (!title) throw new Refusal(400, "Give the deck a title.");
  const kind = CATALOG_KINDS.find((k) => k === body.kind);
  if (!kind) throw new Refusal(400, "Pick what the deck is for.");
  const customKind = kind === "custom" ? tidy(body.customKind, FIELD_MAX.customKind) : null;
  if (kind === "custom" && !customKind) throw new Refusal(400, "Name the custom type.");
  return {
    title,
    college,
    professor,
    course,
    kind,
    customKind,
    term: tidy(body.term, FIELD_MAX.term),
    description: tidy(body.description, FIELD_MAX.description, false),
    uploader: tidy(body.uploader, FIELD_MAX.uploader) ?? "A student",
  };
}

function cleanCards(value: unknown): CardSnapshot[] {
  if (!Array.isArray(value)) throw new Refusal(400, "That deck has no cards to share.");
  if (value.length > LIMITS.maxCards) {
    throw new Refusal(413, `Decks in the catalog can have up to ${LIMITS.maxCards} cards.`);
  }
  const cards: CardSnapshot[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const card = raw as Record<string, unknown>;
    const question = tidy(card.question, CARD_MAX.question, false);
    const directAnswer = tidy(card.directAnswer, CARD_MAX.answer, false);
    if (!question || !directAnswer) continue;
    cards.push({
      topic: tidy(card.topic, CARD_MAX.topic),
      question,
      directAnswer,
      fullExplanation: tidy(card.fullExplanation, CARD_MAX.explanation, false),
      cardType: tidy(card.cardType, 40) ?? "definition",
      sourceExcerpt: tidy(card.sourceExcerpt, CARD_MAX.excerpt, false),
      essentialPoints: (Array.isArray(card.essentialPoints) ? card.essentialPoints : [])
        .map((p) => tidy(p, CARD_MAX.point, false))
        .filter((p): p is string => Boolean(p))
        .slice(0, CARD_MAX.points),
    });
  }
  if (cards.length < LIMITS.minCards) {
    throw new Refusal(400, `A shared deck needs at least ${LIMITS.minCards} cards.`);
  }
  return cards;
}

function cleanGuide(value: unknown): GuideSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const guide = value as Record<string, unknown>;
  const sentences = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((s) => tidy(s, GUIDE_MAX.sentence, false))
      .filter((s): s is string => Boolean(s))
      .slice(0, GUIDE_MAX.sentences);

  let sectionBudget = LIMITS.guideSections;
  const topics = (Array.isArray(guide.topics) ? guide.topics : []).slice(0, LIMITS.guideTopics).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const topic = raw as Record<string, unknown>;
    const sections = (Array.isArray(topic.sections) ? topic.sections : []).flatMap((s) => {
      if (!s || typeof s !== "object" || sectionBudget <= 0) return [];
      const section = s as Record<string, unknown>;
      const conceptName = tidy(section.conceptName, GUIDE_MAX.concept);
      if (!conceptName) return [];
      sectionBudget -= 1;
      return [
        {
          conceptName,
          definition: sentences(section.definition),
          breakdown: sentences(section.breakdown),
          example: sentences(section.example),
        },
      ];
    });
    if (sections.length === 0) return [];
    return [{ title: tidy(topic.title, GUIDE_MAX.title) ?? "Concepts", intro: tidy(topic.intro, GUIDE_MAX.intro, false) ?? "", sections }];
  });
  if (topics.length === 0) return null;
  return { overview: tidy(guide.overview, GUIDE_MAX.overview, false), topics };
}

/* ------------------------------------------------------------- Rate limits */

async function sharingOpen(env: CatalogEnv) {
  const raw = await env.LICENSES.get(SETTINGS_KEY);
  const settings = raw ? (JSON.parse(raw) as { publishing?: boolean }) : {};
  if (settings.publishing === false) {
    throw new Refusal(503, "Sharing to the catalog is paused right now. Browsing and adding decks still work.");
  }
}

/**
 * The key the check runs on. A share without one is refused before anything
 * else is spent: the catalog has no key of its own to fall back on.
 */
export function moderatorOf(body: Record<string, unknown>): Moderator {
  const raw = body.moderation as { provider?: unknown; key?: unknown } | undefined;
  const provider = raw?.provider;
  const key = typeof raw?.key === "string" ? raw.key.trim() : "";
  if (typeof provider !== "string" || !(provider in MODERATION_MODELS) || !key) {
    throw new Refusal(
      400,
      "Sharing needs a Gemini, Claude or OpenAI API key in Settings, to check the deck before it's listed. Local models can't run the check.",
    );
  }
  if (key.length > 400 || /\s/.test(key)) throw new Refusal(400, "That API key doesn't look right. Check it in Settings.");
  return { provider: provider as ModerationProvider, key };
}

async function notBanned(db: D1Like, me: string) {
  const ban = await db.prepare(`SELECT 1 AS banned FROM catalog_bans WHERE owner = ?`).bind(me).first();
  if (ban) throw new Refusal(403, "This install can no longer share decks to the catalog.");
}

/** A network, hashed: rate limits need to tell them apart, not know them. */
async function networkOf(request: Request): Promise<string> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return `ip:${(await sha256(`catalog:${ip}`)).slice(0, 32)}`;
}

async function count(db: D1Like, sql: string, ...values: unknown[]) {
  return ((await db.prepare(sql).bind(...values).first<{ n: number }>()) ?? { n: 0 }).n;
}

async function withinLimits(db: D1Like, me: string, ip: string, action: "publish" | "edit") {
  const now = Date.now();
  await db.prepare(`DELETE FROM catalog_attempts WHERE at < ?`).bind(now - 2 * DAY).run();

  const since = (ms: number) => now - ms;
  const byMe = (window: number, extra = "") =>
    count(db, `SELECT count(*) AS n FROM catalog_attempts WHERE who = ? AND action = ? AND at > ? ${extra}`, me, action, since(window));

  const rejected = await count(
    db,
    `SELECT count(*) AS n FROM catalog_attempts WHERE who = ? AND outcome = 'rejected' AND at > ?`,
    me,
    since(DAY),
  );
  if (rejected >= LIMITS.rejectionsPerDay) {
    throw new Refusal(429, "Several of your shares were turned down today, so sharing is off for this install until tomorrow.", DAY);
  }

  if (action === "publish") {
    if ((await byMe(HOUR)) >= LIMITS.publishPerHour) {
      throw new Refusal(429, "You've shared a lot in the last hour. Try again later.", HOUR);
    }
    if ((await byMe(DAY)) >= LIMITS.publishPerDay) {
      throw new Refusal(429, "You've reached today's limit for sharing decks. Try again tomorrow.", DAY);
    }
    const fromNetwork = await count(
      db,
      `SELECT count(*) AS n FROM catalog_attempts WHERE who = ? AND action = 'publish' AND at > ?`,
      ip,
      since(DAY),
    );
    if (fromNetwork >= LIMITS.publishPerDayPerIp) {
      throw new Refusal(429, "Too many decks have been shared from this network today. Try again tomorrow.", DAY);
    }
  } else {
    if ((await byMe(DAY)) >= LIMITS.editsPerDay) {
      throw new Refusal(429, "You've edited your listings a lot today. Try again tomorrow.", DAY);
    }
    const fromNetwork = await count(
      db,
      `SELECT count(*) AS n FROM catalog_attempts WHERE who = ? AND action = 'edit' AND at > ?`,
      ip,
      since(DAY),
    );
    if (fromNetwork >= LIMITS.editsPerDayPerIp) {
      throw new Refusal(429, "Too many listings have been edited from this network today. Try again tomorrow.", DAY);
    }
  }
}

async function record(db: D1Like, who: string[], action: string, outcome: string) {
  const at = Date.now();
  for (const w of who) {
    await db.prepare(`INSERT INTO catalog_attempts (who, action, outcome, at) VALUES (?, ?, ?, ?)`).bind(w, action, outcome, at).run();
  }
}

/* -------------------------------------------------------------- Moderation */

export type Verdict = { allowed: boolean; reason: string | null };

function detailsText(d: Details): string {
  return [
    `Title: ${d.title}`,
    `College: ${d.college}`,
    `Professor: ${d.professor}`,
    `Course: ${d.course}`,
    `Type: ${d.kind === "custom" ? d.customKind : d.kind}`,
    d.term ? `Term: ${d.term}` : "",
    `Shared by: ${d.uploader}`,
    d.description ? `Description: ${d.description}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function moderationText(details: Details, cards: CardSnapshot[], guide: GuideSnapshot | null): string {
  const parts = [detailsText(details), "", "CARDS"];
  cards.forEach((c, i) => {
    parts.push(
      `${i + 1}. ${c.topic ? `[${c.topic}] ` : ""}Q: ${c.question}`,
      `   A: ${c.directAnswer}`,
      ...(c.fullExplanation ? [`   Explanation: ${c.fullExplanation}`] : []),
      ...(c.sourceExcerpt ? [`   Excerpt: ${c.sourceExcerpt}`] : []),
      ...(c.essentialPoints.length ? [`   Points: ${c.essentialPoints.join("; ")}`] : []),
    );
  });
  if (guide) {
    parts.push("", "STUDY GUIDE");
    if (guide.overview) parts.push(guide.overview);
    for (const t of guide.topics) {
      parts.push(`## ${t.title}`, t.intro);
      for (const s of t.sections) {
        parts.push(`### ${s.conceptName}`, ...s.definition, ...s.breakdown, ...s.example);
      }
    }
  }
  return parts.join("\n");
}

const SLURS = /\b(n[i1!]gg(?:er|a|az|as|ers)|f[a@]gg?(?:ot|ots)|k[i1]kes?|ch[i1]nks?|tr[a@]nn(?:y|ies)|wetbacks?|sp[i1]cs?)\b/i;
const LINK = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|gg|ly|xyz|shop|link|me|co)\b/gi;
const CONTACT = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\b(?:snap(?:chat)?|insta(?:gram)?|discord|telegram|whatsapp|venmo|cashapp)\s*[:@]/i;

/**
 * The obvious cases, turned away without spending a model call: slurs,
 * listing details that advertise or carry contact details, link spam, and
 * text that is one character over and over.
 */
export function prefilter(text: string, details?: string): Verdict {
  if (SLURS.test(text)) return { allowed: false, reason: "It contains hateful language." };
  const head = details ?? text.split("\nCARDS")[0];
  if ((head.match(LINK) ?? []).length > 0) return { allowed: false, reason: "Links aren't allowed in the listing details." };
  if (CONTACT.test(head)) return { allowed: false, reason: "Contact details and social handles aren't allowed." };
  if ((text.match(LINK) ?? []).length > 25) return { allowed: false, reason: "It has too many links to be study material." };
  if (/(.)\1{40,}/.test(text)) return { allowed: false, reason: "It doesn't look like study material." };
  return { allowed: true, reason: null };
}

const SYSTEM = `You review study decks before they are listed in a public catalog that college students browse. A deck is flashcards (and sometimes a study guide) a student made for a class, with listing details: college, professor, course, title and description.

Allow ordinary academic material on any subject, including mature subjects taught in college (anatomy and sexual health, drugs and pharmacology, war, genocide, crime, slurs discussed historically, medicine and self-harm as clinical topics). Professors and colleges are named in every listing; that is expected.

Refuse the deck if any part of it:
- is sexually explicit or pornographic, or sexualises minors in any way
- harasses, insults, threatens or demeans a real person (including the professor or other students), or attacks people for a protected trait
- gives real instructions for weapons, explosives, drugs synthesis, hacking or other serious harm, or encourages self-harm or suicide
- exposes private information: home addresses, phone numbers, emails, student ids, grades or medical details of identifiable people
- advertises, sells, links out, solicits contact, or is spam
- is gibberish, a test of the system, or otherwise not study material
- appears to be a stolen answer key for an assessment that is still open (for example "answers to this week's take-home exam")

When unsure whether something is academic, lean towards allowing it. Answer with JSON only.`;

const SCHEMA = {
  type: "object",
  properties: {
    allowed: { type: "boolean" },
    category: {
      type: "string",
      enum: ["ok", "sexual", "harassment", "hate", "dangerous", "self_harm", "private_info", "spam", "not_study_material", "cheating", "other"],
    },
    reason: { type: "string", description: "One short sentence for the student, when refused." },
  },
  required: ["allowed", "category", "reason"],
};

/**
 * The model's verdict on `text`, from the cache when this exact text has
 * been checked before (by any provider). Only the models' own verdicts and
 * the prefilter's are cached; a failed call is not, and refuses the share.
 */
async function moderate(db: D1Like, moderator: Moderator, text: string, who: string[], action: string): Promise<Verdict> {
  const hash = await sha256(`v1:${text}`);
  const cached = await db
    .prepare(`SELECT allowed, reason FROM catalog_verdicts WHERE hash = ?`)
    .bind(hash)
    .first<{ allowed: number; reason: string | null }>();
  if (cached) {
    const verdict = { allowed: cached.allowed === 1, reason: cached.reason };
    await record(db, who, action, verdict.allowed ? "allowed" : "rejected");
    return verdict;
  }

  let verdict = prefilter(text);
  let model = "prefilter";
  if (verdict.allowed) {
    model = `${moderator.provider}:${MODERATION_MODELS[moderator.provider]}`;
    try {
      verdict = await askModerator(moderator, text);
    } catch (error) {
      await record(db, who, action, "error");
      if (error instanceof Refusal) throw error;
      // The message never carries the key: see ModeratorError.
      console.error("[catalog] moderation failed", moderator.provider, error instanceof Error ? error.message : "unknown");
      throw new Refusal(503, "The deck couldn't be checked right now, so it wasn't shared. Try again in a few minutes.");
    }
  }

  await db
    .prepare(`INSERT OR REPLACE INTO catalog_verdicts (hash, allowed, reason, model, checked_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(hash, verdict.allowed ? 1 : 0, verdict.reason, model, Date.now())
    .run();
  await record(db, who, action, verdict.allowed ? "allowed" : "rejected");
  return verdict;
}

function refusalMessage(reason: string | null) {
  return `This deck wasn't shared: it didn't pass the catalog's content check.${reason ? ` ${reason}` : ""}`;
}

const USER_PROMPT = (text: string) => `Review this deck.\n\n<deck>\n${text}\n</deck>`;

/**
 * A provider's answer to a call that failed. Only the status goes in the
 * message: error bodies can quote part of the key back.
 */
async function providerFailure(moderator: Moderator, response: Response): Promise<never> {
  await response.body?.cancel().catch(() => {});
  const name = PROVIDER_NAMES[moderator.provider];
  if (response.status === 401 || response.status === 403) {
    throw new Refusal(400, `Your ${name} API key was turned down, so the deck couldn't be checked. Check the key in Settings.`);
  }
  if (response.status === 429) {
    throw new Refusal(429, `Your ${name} API key is over its rate limit or out of credit. Try again later.`, 600);
  }
  throw new Error(`${name} ${response.status}`);
}

/** The verdict inside a model's JSON answer. */
export function readVerdict(answer: string, provider: string): Verdict {
  const json = answer.slice(answer.indexOf("{"), answer.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json) as { allowed?: unknown; category?: unknown; reason?: unknown };
  if (typeof parsed.allowed !== "boolean") throw new Error(`${provider} gave no verdict.`);
  if (parsed.allowed && parsed.category !== "ok" && parsed.category !== undefined) {
    // Allowed but filed under a harm: treat the contradiction as a refusal.
    return { allowed: false, reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : null };
  }
  return {
    allowed: parsed.allowed,
    reason: parsed.allowed ? null : typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 300) || null : null,
  };
}

/**
 * The same instructions and the same answer shape, on whichever provider
 * the sharer has a key for. Declined outright (a block, a safety stop, a
 * refusal) counts as a refusal, not an error.
 */
export async function askModerator(moderator: Moderator, text: string): Promise<Verdict> {
  if (moderator.provider === "anthropic") return askClaude(moderator, text);
  if (moderator.provider === "openai") return askOpenAi(moderator, text);
  return askGemini(moderator, text);
}

const declined = (provider: ModerationProvider): Verdict => ({
  allowed: false,
  reason: `${PROVIDER_NAMES[provider]} declined to review it.`,
});

async function askGemini(moderator: Moderator, text: string): Promise<Verdict> {
  const model = MODERATION_MODELS.gemini;
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": moderator.key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: USER_PROMPT(text) }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: "low" },
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  // Gemini answers a bad key with 400 API_KEY_INVALID rather than 401.
  if (response.status === 400) {
    const body = await response.clone().text().catch(() => "");
    if (/API_KEY_INVALID|API key not valid/i.test(body)) {
      return providerFailure(moderator, new Response(null, { status: 401 }));
    }
  }
  if (!response.ok) return providerFailure(moderator, response);

  const body = (await response.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  if (body.promptFeedback?.blockReason) return declined("gemini");
  const candidate = body.candidates?.[0];
  if (candidate && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(candidate.finishReason ?? "")) {
    return declined("gemini");
  }
  const answer = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
  return readVerdict(answer, "Gemini");
}

async function askClaude(moderator: Moderator, text: string): Promise<Verdict> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": moderator.key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODERATION_MODELS.anthropic,
      max_tokens: 1024,
      temperature: 0,
      system: `${SYSTEM}\n\nReply with one JSON object and nothing else, matching this JSON schema:\n${JSON.stringify(SCHEMA)}`,
      messages: [{ role: "user", content: USER_PROMPT(text) }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) return providerFailure(moderator, response);

  const body = (await response.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (body.stop_reason === "refusal") return declined("anthropic");
  const answer = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
  return readVerdict(answer, "Claude");
}

async function askOpenAi(moderator: Moderator, text: string): Promise<Verdict> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${moderator.key}` },
    body: JSON.stringify({
      model: MODERATION_MODELS.openai,
      temperature: 0,
      max_completion_tokens: 2048,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: USER_PROMPT(text) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "verdict", strict: true, schema: { ...SCHEMA, additionalProperties: false } },
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) return providerFailure(moderator, response);

  const body = (await response.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  };
  const choice = body.choices?.[0];
  if (choice?.message?.refusal || choice?.finish_reason === "content_filter") return declined("openai");
  return readVerdict(choice?.message?.content ?? "", "OpenAI");
}

/* ------------------------------------------------------------------- Admin */

async function handleAdminCatalog(request: Request, env: CatalogEnv, path: string): Promise<Response> {
  if (request.method === "PUT" && path === "/admin/catalog/settings") {
    const body = (await request.json().catch(() => ({}))) as { publishing?: unknown };
    const settings = { publishing: body.publishing !== false };
    await env.LICENSES.put(SETTINGS_KEY, JSON.stringify(settings));
    return ok(settings);
  }

  const db = env.CATALOG;
  if (!db) throw new Refusal(503, "No catalog database is bound.");

  if (request.method === "GET" && path === "/admin/catalog") {
    const status = new URL(request.url).searchParams.get("status");
    const { results } = await db
      .prepare(
        `SELECT ${LIST_COLUMNS}, (SELECT count(*) FROM catalog_reports r WHERE r.deck_id = d.id) AS reports
         FROM catalog_decks d ${status ? "WHERE status = ?" : ""} ORDER BY reports DESC, created_at DESC LIMIT 500`,
      )
      .bind(...(status ? [status] : []))
      .all<Row & { reports: number }>();
    return ok({ decks: results.map((row) => ({ ...toDeck(row, null), owner: row.owner, reports: row.reports })) });
  }

  const match = /^\/admin\/catalog\/([a-f0-9-]{36})(?:\/(hide|restore|ban))?$/i.exec(path);
  if (!match) return new Response("Not found", { status: 404 });
  const [, id, action] = match;
  const row = await db.prepare(`SELECT owner FROM catalog_decks WHERE id = ?`).bind(id).first<{ owner: string }>();
  if (!row) throw new Refusal(404, "No such deck.");

  if (request.method === "DELETE" && !action) {
    await db.prepare(`DELETE FROM catalog_decks WHERE id = ?`).bind(id).run();
    await db.prepare(`DELETE FROM catalog_reports WHERE deck_id = ?`).bind(id).run();
    return ok({ ok: true });
  }
  if (request.method === "POST" && action === "hide") {
    await db.prepare(`UPDATE catalog_decks SET status = 'hidden' WHERE id = ?`).bind(id).run();
    return ok({ ok: true });
  }
  if (request.method === "POST" && action === "restore") {
    await db.prepare(`UPDATE catalog_decks SET status = 'live' WHERE id = ?`).bind(id).run();
    await db.prepare(`DELETE FROM catalog_reports WHERE deck_id = ?`).bind(id).run();
    return ok({ ok: true });
  }
  if (request.method === "POST" && action === "ban") {
    // Bars the owner from sharing and hides everything they have listed.
    await db
      .prepare(`INSERT OR REPLACE INTO catalog_bans (owner, reason, at) VALUES (?, ?, ?)`)
      .bind(row.owner, `deck ${id}`, Date.now())
      .run();
    await db.prepare(`UPDATE catalog_decks SET status = 'hidden' WHERE owner = ?`).bind(row.owner).run();
    return ok({ ok: true });
  }
  return new Response("Not found", { status: 404 });
}

/* ----------------------------------------------------------------- Helpers */

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
