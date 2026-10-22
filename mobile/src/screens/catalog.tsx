/**
 * The shared deck catalog: the same listings the desktop shows, from the
 * app's server. Browse by college, professor and course, preview a deck, add
 * it to your own decks, report one, or share one of yours (checked with your
 * own AI key before it's listed, as on the desktop).
 */
import { Flag, Library, Share2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  CATALOG_KINDS,
  PUBLISH_ATTESTATION,
  kindLabel,
  type CatalogDeck,
  type CatalogDeckDetail,
  type CatalogKind,
} from "@megan/core/catalog/types";

import { useApp } from "../context";
import { catalogClient, filterDecks, readCollege, writeCollege, type Details } from "../data/catalog";
import { listCourses } from "../data/decks";
import { readApiKey } from "../platform/ai";
import { Button, Empty, Notice, Screen, Sheet, plural, useLoad } from "../components/ui";

import { errorText } from "./source";

type Message = { tone: "info" | "error"; text: string } | null;

const BLANK: Details = {
  title: "",
  college: "",
  professor: "",
  course: "",
  kind: "exam",
  customKind: null,
  term: null,
  description: null,
};

export function CatalogScreen() {
  const { db, platform, navigate, changed } = useApp();
  const client = useMemo(() => catalogClient(db), [db]);
  const [decks, setDecks] = useState<CatalogDeck[] | null>(null);
  const [college, setCollege] = useState<string | null>(null);
  const [collegeDraft, setCollegeDraft] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"college" | "all" | "mine">("college");
  const [message, setMessage] = useState<Message>(null);
  const [preview, setPreview] = useState<CatalogDeckDetail | null>(null);
  const [sharing, setSharing] = useState<{ editing: CatalogDeck | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const { decks, offline } = await client.list();
    setDecks(decks);
    if (offline) setMessage({ tone: "error", text: offline });
  }, [client]);

  useEffect(() => {
    void readCollege(db).then((saved) => {
      setCollege(saved);
      setCollegeDraft(saved ?? "");
      if (!saved) setScope("all");
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [db, refresh]);

  async function saveCollege() {
    try {
      const saved = await writeCollege(db, collegeDraft);
      setCollege(saved);
      setScope("college");
      setMessage(null);
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function open(deck: CatalogDeck) {
    setMessage(null);
    try {
      setPreview(await client.get(deck.id));
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function add(deck: CatalogDeck) {
    setBusy(true);
    try {
      const examId = await client.add(deck.id);
      changed();
      void platform.haptics.impact("success");
      setPreview(null);
      navigate({ name: "deck", examId });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    } finally {
      setBusy(false);
    }
  }

  async function report(deck: CatalogDeck) {
    const reason = window.prompt("What's wrong with this deck? (optional)");
    if (reason === null) return;
    try {
      await client.report(deck.id, reason);
      setPreview(null);
      setMessage({ tone: "info", text: "Thanks. The deck has been reported." });
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  async function remove(deck: CatalogDeck) {
    if (!window.confirm(`Remove “${deck.title}” from the catalog? Your own deck stays.`)) return;
    try {
      await client.remove(deck.id);
      setPreview(null);
      setMessage({ tone: "info", text: "Removed from the catalog." });
      await refresh();
    } catch (cause) {
      setMessage({ tone: "error", text: errorText(cause) });
    }
  }

  const shown = useMemo(
    () =>
      decks
        ? filterDecks(decks, { query, college: scope === "college" ? (college ?? "") : "", onlyMine: scope === "mine" })
        : [],
    [decks, query, scope, college],
  );

  // Grouped by professor and course, as the desktop lists them.
  const groups = useMemo(() => {
    const map = new Map<string, CatalogDeck[]>();
    for (const deck of shown) {
      const key = `${deck.course} · ${deck.professor}`;
      map.set(key, [...(map.get(key) ?? []), deck]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shown]);

  if (!client.available) {
    return (
      <Screen title="Catalog">
        <Notice>The catalog isn&apos;t available in this build.</Notice>
      </Screen>
    );
  }

  return (
    <Screen
      title="Catalog"
      actions={
        <button type="button" className="icon-button" aria-label="Share one of your decks" onClick={() => setSharing({ editing: null })}>
          <Share2 aria-hidden />
        </button>
      }
    >
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      {college === null ? (
        <div className="panel stack">
          <p>Which college do you go to? The catalog shows decks from your college first.</p>
          <input className="input" value={collegeDraft} placeholder="e.g. Ohio State" onChange={(e) => setCollegeDraft(e.target.value)} />
          <Button onClick={() => void saveCollege()} disabled={!collegeDraft.trim()}>
            Save
          </Button>
        </div>
      ) : null}

      <input
        className="input"
        type="search"
        value={query}
        placeholder="Search by course, professor or topic"
        aria-label="Search the catalog"
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="segmented" role="group" aria-label="Show">
        {college ? (
          <button type="button" className="chip" aria-pressed={scope === "college"} onClick={() => setScope("college")}>
            {college}
          </button>
        ) : null}
        <button type="button" className="chip" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
          All colleges
        </button>
        <button type="button" className="chip" aria-pressed={scope === "mine"} onClick={() => setScope("mine")}>
          Shared by me
        </button>
      </div>

      {decks === null ? <p className="muted">Loading the catalog…</p> : null}
      {decks && shown.length === 0 ? (
        <Empty title={decks.length === 0 ? "Nothing shared yet" : "No decks match"}>
          <p>Be the first: share one of your decks with the button at the top.</p>
        </Empty>
      ) : null}

      {groups.map(([group, items]) => (
        <div className="section" key={group}>
          <h2 className="section-title">{group}</h2>
          <div className="list">
            {items.map((deck) => (
              <button type="button" className="row" key={deck.id} onClick={() => void open(deck)}>
                <Library aria-hidden />
                <span className="row-main">
                  <span className="row-title">{deck.title}</span>
                  <span className="row-sub">
                    {kindLabel(deck)} · {plural(deck.cardCount, "card")}
                    {deck.term ? ` · ${deck.term}` : ""} · {deck.college}
                  </span>
                </span>
                {deck.mine ? <span className="pill">{deck.status === "hidden" ? "Hidden" : "Yours"}</span> : null}
              </button>
            ))}
          </div>
        </div>
      ))}

      {preview ? (
        <Sheet title={preview.title} onClose={() => setPreview(null)}>
          <p className="muted small">
            {kindLabel(preview)} · {preview.course} · {preview.professor} · {preview.college}
            {preview.term ? ` · ${preview.term}` : ""}
          </p>
          <p className="muted small">
            {plural(preview.cardCount, "card")}
            {preview.sectionCount > 0 ? ` · study guide with ${plural(preview.sectionCount, "section")}` : ""} · shared by{" "}
            {preview.uploader} · added {plural(preview.adds, "time")}
          </p>
          {preview.description ? <p>{preview.description}</p> : null}
          {preview.sampleCards.length > 0 ? (
            <div className="section">
              <h2 className="section-title">Sample cards</h2>
              <div className="list">
                {preview.sampleCards.map((card, i) => (
                  <div className="row" key={i}>
                    <span className="row-main">
                      <span className="row-title">{card.question}</span>
                      <span className="row-sub">{card.answer}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="inline">
            <Button onClick={() => void add(preview)} disabled={busy}>
              {busy ? "Adding…" : "Add to my decks"}
            </Button>
            {preview.mine ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSharing({ editing: preview });
                    setPreview(null);
                  }}
                >
                  Edit details
                </Button>
                <Button variant="danger" onClick={() => void remove(preview)}>
                  Remove
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => void report(preview)}>
                <Flag aria-hidden /> Report
              </Button>
            )}
          </div>
        </Sheet>
      ) : null}

      {sharing ? (
        <ShareSheet
          client={client}
          college={college}
          editing={sharing.editing}
          onClose={() => setSharing(null)}
          onDone={(text) => {
            setSharing(null);
            setMessage({ tone: "info", text });
            setScope("mine");
            void refresh();
          }}
        />
      ) : null}
    </Screen>
  );
}

function ShareSheet({
  client,
  college,
  editing,
  onClose,
  onDone,
}: {
  client: ReturnType<typeof catalogClient>;
  college: string | null;
  editing: CatalogDeck | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { db, platform } = useApp();
  const { data: courses } = useLoad(() => listCourses(db), []);
  const decks = courses?.flatMap((course) => course.decks.map((deck) => ({ ...deck, course: course.title, term: course.term }))) ?? [];
  const [examId, setExamId] = useState("");
  const [details, setDetails] = useState<Details>(() =>
    editing
      ? {
          title: editing.title,
          college: editing.college,
          professor: editing.professor,
          course: editing.course,
          kind: editing.kind,
          customKind: editing.customKind,
          term: editing.term,
          description: editing.description,
        }
      : { ...BLANK, college: college ?? "" },
  );
  const [uploader, setUploader] = useState("");
  const [includeGuide, setIncludeGuide] = useState(true);
  const [attested, setAttested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function pickDeck(id: string) {
    setExamId(id);
    const deck = decks.find((d) => d.examId === id);
    if (deck) setDetails((d) => ({ ...d, title: d.title || deck.title, course: d.course || deck.course, term: d.term || deck.term }));
  }

  const field = (key: keyof Details) => ({
    value: (details[key] as string | null) ?? "",
    onChange: (e: { target: { value: string } }) => setDetails((d) => ({ ...d, [key]: e.target.value })),
  });

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const key = await readApiKey(platform.secrets);
      if (editing) {
        await client.update(editing.id, details, key);
        onDone("Saved. The listing has the new details.");
      } else {
        await client.publish({ ...details, examId, uploader, includeGuide, attested }, key);
        void platform.haptics.impact("success");
        onDone("Shared. Your deck is in the catalog.");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={editing ? "Edit listing" : "Share a deck"} onClose={onClose}>
      <div className="stack">
        {error ? <Notice tone="error">{error}</Notice> : null}
        {editing ? null : (
          <label className="field">
            <span className="field-label">Deck</span>
            <select className="select" value={examId} onChange={(e) => pickDeck(e.target.value)}>
              <option value="">Pick one of your decks</option>
              {decks.map((deck) => (
                <option key={deck.examId} value={deck.examId}>
                  {deck.course} — {deck.title} ({plural(deck.cardCount, "card")})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Title</span>
          <input className="input" {...field("title")} />
        </label>
        <label className="field">
          <span className="field-label">College</span>
          <input className="input" {...field("college")} />
        </label>
        <label className="field">
          <span className="field-label">Professor</span>
          <input className="input" {...field("professor")} />
        </label>
        <label className="field">
          <span className="field-label">Course</span>
          <input className="input" placeholder="e.g. BIO 1113" {...field("course")} />
        </label>
        <label className="field">
          <span className="field-label">For</span>
          <select
            className="select"
            value={details.kind}
            onChange={(e) => setDetails((d) => ({ ...d, kind: e.target.value as CatalogKind }))}
          >
            {CATALOG_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kindLabel({ kind, customKind: null })}
              </option>
            ))}
          </select>
        </label>
        {details.kind === "custom" ? (
          <label className="field">
            <span className="field-label">Custom type</span>
            <input className="input" {...field("customKind")} />
          </label>
        ) : null}
        <label className="field">
          <span className="field-label">Term (optional)</span>
          <input className="input" placeholder="e.g. Fall 2026" {...field("term")} />
        </label>
        <label className="field">
          <span className="field-label">Description (optional)</span>
          <textarea className="textarea" rows={3} {...field("description")} />
        </label>
        {editing ? null : (
          <>
            <label className="field">
              <span className="field-label">Your name as shown (optional)</span>
              <input className="input" value={uploader} placeholder="A student" onChange={(e) => setUploader(e.target.value)} />
            </label>
            <label className="switch">
              <span>Include the study guide</span>
              <input type="checkbox" checked={includeGuide} onChange={(e) => setIncludeGuide(e.target.checked)} />
            </label>
            <label className="switch">
              <span>{PUBLISH_ATTESTATION}</span>
              <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            </label>
          </>
        )}
        <p className="muted small">The catalog checks the deck with your AI key before listing it, then forgets the key.</p>
        <Button onClick={() => void submit()} disabled={busy || (!editing && (!examId || !attested))}>
          {busy ? "Checking…" : editing ? "Save" : "Share"}
        </Button>
      </div>
    </Sheet>
  );
}
