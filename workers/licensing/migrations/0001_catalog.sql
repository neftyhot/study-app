-- The shared deck catalog (src/catalog.ts). Applied with:
--   npx wrangler d1 migrations apply study-app-catalog --remote

CREATE TABLE catalog_decks (
  id TEXT PRIMARY KEY,
  -- The sharing install's id. Never sent to anyone else.
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  college TEXT NOT NULL,
  professor TEXT NOT NULL,
  course TEXT NOT NULL,
  kind TEXT NOT NULL,
  custom_kind TEXT,
  term TEXT,
  description TEXT,
  uploader TEXT NOT NULL,
  cards_json TEXT NOT NULL,
  guide_json TEXT,
  card_count INTEGER NOT NULL,
  section_count INTEGER NOT NULL,
  adds INTEGER NOT NULL DEFAULT 0,
  -- sha-256 of the cards and guide, so the same deck is listed once.
  content_hash TEXT NOT NULL,
  -- live, or hidden (reported, awaiting review, or taken down).
  status TEXT NOT NULL DEFAULT 'live',
  source_exam_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX catalog_decks_live ON catalog_decks (status, created_at);
CREATE INDEX catalog_decks_owner ON catalog_decks (owner);
CREATE INDEX catalog_decks_hash ON catalog_decks (content_hash);

-- Gemini's answer for a given text, so the same text is never checked twice.
CREATE TABLE catalog_verdicts (
  hash TEXT PRIMARY KEY,
  allowed INTEGER NOT NULL,
  reason TEXT,
  model TEXT,
  checked_at INTEGER NOT NULL
);

-- Every publish or edit attempt, for the rate limits. Pruned after two days.
CREATE TABLE catalog_attempts (
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX catalog_attempts_who ON catalog_attempts (who, at);
CREATE INDEX catalog_attempts_at ON catalog_attempts (at);

CREATE TABLE catalog_reports (
  deck_id TEXT NOT NULL,
  reporter TEXT NOT NULL,
  reason TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (deck_id, reporter)
);

-- One add per install per deck counts toward `adds`.
CREATE TABLE catalog_adds (
  deck_id TEXT NOT NULL,
  installer TEXT NOT NULL,
  PRIMARY KEY (deck_id, installer)
);

-- Installs the developer has barred from sharing.
CREATE TABLE catalog_bans (
  owner TEXT PRIMARY KEY,
  reason TEXT,
  at INTEGER NOT NULL
);
