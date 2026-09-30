/**
 * The deck catalog against a real SQLite database standing in for D1, with
 * the migration applied as written, and Gemini replaced by a stub.
 */
import { readFileSync } from "node:fs";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIMITS, MODERATION_MODELS, prefilter, type D1Like, type D1Statement } from "./catalog";
import worker, { type Env, type KVLike } from "./index";

function d1(sqlite: Database.Database): D1Like {
  return {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement: D1Statement = {
        bind(...next) {
          values = next;
          return statement;
        },
        async first<T>() {
          return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null;
        },
        async all<T>() {
          return { results: sqlite.prepare(sql).all(...values) as T[] };
        },
        async run() {
          return { meta: { changes: sqlite.prepare(sql).run(...values).changes } };
        },
      };
      return statement;
    },
  };
}

class MemoryKV implements KVLike {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list({ prefix }: { prefix: string }) {
    return { keys: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const CAROL = "33333333-3333-4333-8333-333333333333";
const DAVE = "44444444-4444-4444-8444-444444444444";
const TOKEN = "admin-token-long-enough-for-tests-0123456789";

let sqlite: Database.Database;
let env: Env;
let gemini: ReturnType<typeof vi.fn>;
let verdict: Record<string, unknown>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  for (const migration of ["0001_catalog.sql", "0002_report_network.sql"]) {
    sqlite.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  env = {
    STRIPE_WEBHOOK_SECRET: "whsec",
    LICENSE_PRIVATE_KEY: "",
    ADMIN_TOKEN: TOKEN,
    LICENSES: new MemoryKV(),
    CATALOG: d1(sqlite),
  };
  verdict = { allowed: true, category: "ok", reason: "" };
  gemini = vi.fn(async () =>
    Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(verdict) }] } }] }),
  );
  vi.stubGlobal("fetch", gemini);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sqlite.close();
});

function call(method: string, path: string, options: { who?: string; body?: unknown; ip?: string; admin?: boolean } = {}) {
  const headers: Record<string, string> = { "cf-connecting-ip": options.ip ?? "203.0.113.7" };
  if (options.who) headers["x-install-id"] = options.who;
  if (options.admin) headers.authorization = `Bearer ${TOKEN}`;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return worker.fetch(
    new Request(`https://licensing.test${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    env,
  );
}

let serial = 0;
function deck(overrides: Record<string, unknown> = {}) {
  serial += 1;
  return {
    title: "Midterm 2",
    college: "State University",
    professor: "Dr. Rivera",
    course: "BIO 201",
    kind: "exam",
    term: "Fall 2026",
    description: "Cell signalling and membranes.",
    uploader: "Sam",
    sourceExamId: "exam-1",
    moderation: { provider: "gemini", key: "test-key-gemini" },
    cards: [1, 2, 3, 4].map((n) => ({
      topic: "Membranes",
      question: `What does protein ${n}-${serial} do?`,
      directAnswer: `It moves ions across the membrane (${n}).`,
      fullExplanation: null,
      cardType: "definition",
      sourceExcerpt: null,
      essentialPoints: ["ions", "membrane"],
    })),
    guide: {
      overview: "How cells talk.",
      topics: [{ title: "Signals", intro: "Intro", sections: [{ conceptName: "Receptors", definition: ["A"], breakdown: [], example: [] }] }],
    },
    ...overrides,
  };
}

async function publish(who = ALICE, body = deck(), ip?: string) {
  const response = await call("POST", "/catalog", { who, body, ip });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("sharing", () => {
  it("lists a deck Gemini allows, and hides the owner from everyone else", async () => {
    const shared = await publish();
    expect(shared.status).toBe(201);
    expect(gemini).toHaveBeenCalledTimes(1);
    const [url, init] = gemini.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-3.7-flash:generateContent");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key-gemini");
    expect(String(init.body)).toContain("What does protein 1");

    const mine = (await (await call("GET", "/catalog", { who: ALICE })).json()) as { decks: Record<string, unknown>[] };
    expect(mine.decks[0]).toMatchObject({ title: "Midterm 2", mine: true, sourceExamId: "exam-1", cardCount: 4, sectionCount: 1 });

    const theirs = (await (await call("GET", "/catalog", { who: BOB })).json()) as { decks: Record<string, unknown>[] };
    expect(theirs.decks[0]).toMatchObject({ mine: false, sourceExamId: null });
    expect(JSON.stringify(theirs)).not.toContain(ALICE);
  });

  it("never lists a deck Gemini refuses or declines", async () => {
    verdict = { allowed: false, category: "harassment", reason: "It insults a named student." };
    const refused = await publish();
    expect(refused.status).toBe(422);
    expect(refused.body.error).toContain("insults a named student");

    gemini.mockImplementationOnce(async () => Response.json({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }));
    expect((await publish()).status).toBe(422);

    gemini.mockImplementationOnce(async () => Response.json({ candidates: [{ finishReason: "SAFETY" }] }));
    expect((await publish(BOB)).status).toBe(422);

    // Allowed, but filed under a harm: still refused.
    verdict = { allowed: true, category: "sexual", reason: "Explicit." };
    expect((await publish(CAROL)).status).toBe(422);

    const listed = (await (await call("GET", "/catalog", { who: ALICE })).json()) as { decks: unknown[] };
    expect(listed.decks).toHaveLength(0);
  });

  it("fails closed when the check can't run, without counting it against the student", async () => {
    gemini.mockImplementationOnce(async () => new Response("boom", { status: 500 }));
    expect((await publish()).status).toBe(503);
    gemini.mockImplementationOnce(async () => Response.json({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }));
    expect((await publish()).status).toBe(503);
    expect((await publish()).status).toBe(201);
  });

  it("needs the sharer's own key, and is off when the developer pauses it", async () => {
    for (const moderation of [undefined, { provider: "local", key: "x".repeat(20) }, { provider: "gemini", key: "" }]) {
      const refused = await publish(ALICE, deck({ moderation }));
      expect(refused.status).toBe(400);
      expect(String(refused.body.error)).toMatch(/Local models can't/);
    }
    expect(gemini).not.toHaveBeenCalled();

    expect((await call("PUT", "/admin/catalog/settings", { admin: true, body: { publishing: false } })).status).toBe(200);
    expect((await publish()).status).toBe(503);
    expect(gemini).not.toHaveBeenCalled();
    // Browsing still works.
    expect((await call("GET", "/catalog")).status).toBe(200);

    await call("PUT", "/admin/catalog/settings", { admin: true, body: { publishing: true } });
    expect((await publish()).status).toBe(201);
  });

  it("turns away the obvious without asking Gemini", async () => {
    const spam = await publish(ALICE, deck({ description: "Answers at cheap-notes.shop, DM me" }));
    expect(spam.status).toBe(422);
    const contact = await publish(BOB, deck({ uploader: "snap: sam123" }));
    expect(contact.status).toBe(422);
    expect(gemini).not.toHaveBeenCalled();
    expect(prefilter("Q: What did the Nuremberg trials decide?").allowed).toBe(true);
  });

  it("asks Gemini once per text, however often it is sent", async () => {
    verdict = { allowed: false, category: "spam", reason: "Spam." };
    const body = deck();
    await publish(ALICE, body);
    await publish(ALICE, body);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("lists the same deck once", async () => {
    const body = deck();
    expect((await publish(ALICE, body)).status).toBe(201);
    const again = await publish(BOB, { ...body, title: "Copy" });
    expect(again.status).toBe(409);
    expect(gemini).toHaveBeenCalledTimes(1);
  });

  it("validates before spending anything", async () => {
    expect((await publish(ALICE, deck({ college: " " }))).status).toBe(400);
    expect((await publish(ALICE, deck({ cards: [] }))).status).toBe(400);
    expect((await publish(ALICE, deck({ kind: "custom" }))).status).toBe(400);
    const tooMany = deck().cards[0];
    expect((await publish(ALICE, deck({ cards: Array.from({ length: LIMITS.maxCards + 1 }, () => tooMany) }))).status).toBe(413);
    expect((await call("POST", "/catalog", { body: deck() })).status).toBe(400);
    expect(gemini).not.toHaveBeenCalled();
  });
});

describe("spam limits", () => {
  it("caps shares per hour", async () => {
    for (let i = 0; i < LIMITS.publishPerHour; i++) expect((await publish()).status).toBe(201);
    const blocked = await call("POST", "/catalog", { who: ALICE, body: deck() });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("3600");
    expect(gemini).toHaveBeenCalledTimes(LIMITS.publishPerHour);
  });

  it("stops an install that keeps getting refused", async () => {
    verdict = { allowed: false, category: "spam", reason: "Spam." };
    for (let i = 0; i < LIMITS.rejectionsPerDay; i++) expect((await publish()).status).toBe(422);
    verdict = { allowed: true, category: "ok", reason: "" };
    expect((await publish()).status).toBe(429);
    expect(gemini).toHaveBeenCalledTimes(LIMITS.rejectionsPerDay);
  });

  it("caps one network, whatever install ids it uses", async () => {
    const ids = Array.from({ length: LIMITS.publishPerDayPerIp + 1 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`);
    for (const id of ids.slice(0, -1)) expect((await publish(id)).status).toBe(201);
    expect((await publish(ids.at(-1))).status).toBe(429);
    expect((await publish(ids.at(-1), deck(), "198.51.100.1")).status).toBe(201);
  });

});

describe("checking on the sharer's key", () => {
  it("runs the same check on Claude", async () => {
    gemini.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test-key");
      const sent = JSON.parse(String(init.body));
      expect(sent.model).toBe(MODERATION_MODELS.anthropic);
      expect(sent.system).toMatch(/study/i);
      return Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: `Here: ${JSON.stringify(verdict)}` }] });
    });
    const moderation = { provider: "anthropic", key: "sk-ant-test-key" };
    expect((await publish(ALICE, deck({ moderation }))).status).toBe(201);
    verdict = { allowed: false, category: "harassment", reason: "Insulting." };
    const refused = await publish(ALICE, deck({ moderation }));
    expect(refused.status).toBe(422);
    gemini.mockImplementationOnce(async () => Response.json({ stop_reason: "refusal", content: [] }));
    expect((await publish(BOB, deck({ moderation }))).status).toBe(422);
  });

  it("runs the same check on OpenAI", async () => {
    gemini.mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-openai-test-key");
      const sent = JSON.parse(String(init.body));
      expect(sent.model).toBe(MODERATION_MODELS.openai);
      expect(sent.response_format.json_schema.strict).toBe(true);
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(verdict) } }] });
    });
    const moderation = { provider: "openai", key: "sk-openai-test-key" };
    expect((await publish(ALICE, deck({ moderation }))).status).toBe(201);
    gemini.mockImplementationOnce(async () =>
      Response.json({ choices: [{ finish_reason: "stop", message: { content: null, refusal: "No." } }] }),
    );
    expect((await publish(ALICE, deck({ moderation }))).status).toBe(422);
  });

  it("says when a key is turned down, without repeating it or the provider's reply", async () => {
    const key = "sk-ant-secret-1234567890";
    gemini.mockImplementation(async () => new Response(`invalid x-api-key ${key}`, { status: 401 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const refused = await publish(ALICE, deck({ moderation: { provider: "anthropic", key } }));
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/Claude API key was turned down/);
    expect(JSON.stringify(refused.body)).not.toContain(key);

    gemini.mockImplementation(async () => new Response(`quota for ${key}`, { status: 429 }));
    const limited = await publish(ALICE, deck({ moderation: { provider: "anthropic", key } }));
    expect(limited.status).toBe(429);

    gemini.mockImplementation(async () => new Response(`upstream ${key}`, { status: 500 }));
    expect((await publish(ALICE, deck({ moderation: { provider: "anthropic", key } }))).status).toBe(503);
    for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain(key);
    spy.mockRestore();
  });

  it("reads Gemini's bad-key answer as a bad key", async () => {
    gemini.mockImplementationOnce(async () =>
      Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 }),
    );
    const refused = await publish();
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/Gemini API key was turned down/);
  });

  it("never stores the key", async () => {
    expect((await publish()).status).toBe(201);
    const dump = JSON.stringify(sqlite.prepare("SELECT * FROM catalog_decks").all()) +
      JSON.stringify(sqlite.prepare("SELECT * FROM catalog_verdicts").all());
    expect(dump).not.toContain("test-key-gemini");
  });
});

describe("owning a listing", () => {
  async function shared() {
    const { body } = await publish();
    return body.id as string;
  }

  it("lets only the owner edit or remove it, and checks edits again", async () => {
    const id = await shared();
    const edit = { ...deck(), title: "Midterm 2 (curve)" };
    expect((await call("PATCH", `/catalog/${id}`, { who: BOB, body: edit })).status).toBe(403);
    const edited = await call("PATCH", `/catalog/${id}`, { who: ALICE, body: edit });
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ title: "Midterm 2 (curve)" });
    expect(gemini).toHaveBeenCalledTimes(2);

    verdict = { allowed: false, category: "harassment", reason: "Insulting." };
    expect((await call("PATCH", `/catalog/${id}`, { who: ALICE, body: { ...edit, title: "Rivera is an idiot" } })).status).toBe(422);

    expect((await call("DELETE", `/catalog/${id}`, { who: BOB })).status).toBe(403);
    expect((await call("DELETE", `/catalog/${id}`, { who: ALICE })).status).toBe(200);
    expect((await call("GET", `/catalog/${id}`, { who: ALICE })).status).toBe(404);
  });

  it("previews and hands over the whole deck, counting each install once", async () => {
    const id = await shared();
    const preview = (await (await call("GET", `/catalog/${id}`, { who: BOB })).json()) as Record<string, unknown>;
    expect(preview.sampleCards).toHaveLength(4);
    expect(preview.topics).toEqual([{ title: "Signals", concepts: ["Receptors"] }]);

    const added = (await (await call("POST", `/catalog/${id}/add`, { who: BOB })).json()) as { cards: unknown[] };
    expect(added.cards).toHaveLength(4);
    await call("POST", `/catalog/${id}/add`, { who: BOB });
    await call("POST", `/catalog/${id}/add`, { who: ALICE });
    const listed = (await (await call("GET", "/catalog")).json()) as { decks: { adds: number }[] };
    expect(listed.decks[0].adds).toBe(1);
  });

  it("caps reports and edits from one network, whatever install ids it uses", async () => {
    const id = await shared();
    const other = "55555555-5555-4555-8555-555555555555";
    expect((await call("POST", `/catalog/${id}/report`, { who: BOB, body: {} })).status).toBe(200);
    const { network } = sqlite.prepare(`SELECT network FROM catalog_reports WHERE reporter = ?`).get(BOB) as { network: string };
    expect(network).toMatch(/^ip:/);
    const insert = sqlite.prepare(`INSERT INTO catalog_reports (deck_id, reporter, reason, at, network) VALUES (?, ?, NULL, ?, ?)`);
    for (let i = 1; i < LIMITS.reportsPerDayPerIp; i++) insert.run(`other-${i}`, `fake-${i}`, Date.now(), network);
    expect((await call("POST", `/catalog/${id}/report`, { who: other, body: {} })).status).toBe(429);
    expect((await call("POST", `/catalog/${id}/report`, { who: other, body: {}, ip: "198.51.100.9" })).status).toBe(200);

    const attempt = sqlite.prepare(`INSERT INTO catalog_attempts (who, action, outcome, at) VALUES (?, 'edit', 'allowed', ?)`);
    for (let i = 0; i < LIMITS.editsPerDayPerIp; i++) attempt.run(network, Date.now());
    const edit = { ...deck(), title: "Midterm 2 (curve)" };
    expect((await call("PATCH", `/catalog/${id}`, { who: ALICE, body: edit })).status).toBe(429);
    expect((await call("PATCH", `/catalog/${id}`, { who: ALICE, body: edit, ip: "198.51.100.9" })).status).toBe(200);
  });

  it("hides a deck enough students report, except from its owner", async () => {
    const id = await shared();
    expect((await call("POST", `/catalog/${id}/report`, { who: ALICE, body: {} })).status).toBe(400);
    for (const who of [BOB, BOB, CAROL]) await call("POST", `/catalog/${id}/report`, { who, body: { reason: "spam" } });
    expect(((await (await call("GET", "/catalog")).json()) as { decks: unknown[] }).decks).toHaveLength(1);
    await call("POST", `/catalog/${id}/report`, { who: DAVE, body: {} });
    expect(((await (await call("GET", "/catalog")).json()) as { decks: unknown[] }).decks).toHaveLength(0);
    const own = (await (await call("GET", "/catalog", { who: ALICE })).json()) as { decks: { status: string }[] };
    expect(own.decks[0].status).toBe("hidden");
    expect((await call("POST", `/catalog/${id}/add`, { who: BOB })).status).toBe(404);
  });
});

describe("admin", () => {
  it("needs the token", async () => {
    expect((await call("GET", "/admin/catalog")).status).toBe(401);
  });

  it("reviews, restores, hides and bans", async () => {
    const { body } = await publish();
    const id = body.id as string;
    const all = (await (await call("GET", "/admin/catalog", { admin: true })).json()) as { decks: Record<string, unknown>[] };
    expect(all.decks[0]).toMatchObject({ id, owner: ALICE, reports: 0 });

    await call("POST", `/admin/catalog/${id}/hide`, { admin: true });
    expect(((await (await call("GET", "/catalog")).json()) as { decks: unknown[] }).decks).toHaveLength(0);
    await call("POST", `/admin/catalog/${id}/restore`, { admin: true });
    expect(((await (await call("GET", "/catalog")).json()) as { decks: unknown[] }).decks).toHaveLength(1);

    await call("POST", `/admin/catalog/${id}/ban`, { admin: true });
    expect(((await (await call("GET", "/catalog")).json()) as { decks: unknown[] }).decks).toHaveLength(0);
    expect((await publish()).status).toBe(403);

    expect((await call("DELETE", `/admin/catalog/${id}`, { admin: true })).status).toBe(200);
    expect(((await (await call("GET", "/admin/catalog", { admin: true })).json()) as { decks: unknown[] }).decks).toHaveLength(0);
  });
});
