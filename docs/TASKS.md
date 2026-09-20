# Study App — Task Tracker

Tracks MVP delivery against `docs/PRD.md` ("MVP Target Scope") and `docs/ARCHITECTURE.md`.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked

---

## Phase 0 — Project Foundation ✅

**Goal:** A running Next.js app with a migrated SQLite database and the shared UI kit in place.

- [x] Install Node.js runtime (Homebrew, Node 26.9.0 / npm 11.19.1)
- [x] Scaffold Next.js 16.3.5 (App Router, Turbopack) + TypeScript + Tailwind CSS v4 + React 19
- [x] ESLint flat config + `@/*` path alias
- [x] shadcn/ui initialized (radix base, nova preset); 17 base components added
- [x] Drizzle ORM 0.45 + `better-sqlite3` 13 + `drizzle-kit` 0.31
- [x] Schema for all 9 models from ARCHITECTURE.md (`src/db/schema.ts`)
- [x] Initial migration generated and applied (`drizzle/0000_*.sql`)
- [x] Seed script with a demo Course → Exam (`npm run db:seed`)
- [x] `.env.example` (`DATABASE_URL`, `UPLOADS_DIR`, `ANTHROPIC_API_KEY`); `.gitignore` for `data/`, `*.db`, `.env*.local`
- [x] App shell: responsive layout, header, dark mode, dashboard + exam overview routes

**Verified:** `npm run typecheck`, `npm run lint`, and `npm run build` all pass clean;
`npm run db:migrate` creates all 9 tables; dev server renders the seeded course and exam.

**Notes for future work:**
- Next 16 removes synchronous `params`/`searchParams`/`cookies()` — always `await` them.
  Use the generated `PageProps<"/route">` / `LayoutProps<"/route">` helpers, and re-run
  `npx next typegen` after adding a route.
- `better-sqlite3` is declared in `serverExternalPackages` so Turbopack leaves the native
  module alone.
- `src/db/client.ts` is the bundler-free connection factory used by CLI scripts;
  `src/db/index.ts` is the `server-only` singleton used by app code.

---

## Phase 1 — Ingestion & Extraction (PRD §1, MVP #1)

**Goal:** Upload PDF/PPTX files and persist per-slide/per-page text, tables, and speaker notes with stable indexes.

- [ ] Upload UI: multi-file drag-and-drop scoped to an Exam, with per-file progress and type validation
- [ ] Upload API route: stream to disk under `uploads/{examId}/`, create `SourceFile` rows (status: pending)
- [ ] PDF extractor (`unpdf`): per-page text + page count; preserve page index
- [ ] PPTX extractor (custom OOXML parsing via `jszip` + `fast-xml-parser`): slide text, tables (flattened to markdown), and speaker notes from `notesSlideN.xml`
- [ ] Normalize extractor output to a shared `ExtractedUnit` contract → `SourceSlideOrPage` rows
- [ ] Detect diagram/image presence per slide → set `has_diagram`; record image paths
- [ ] Legibility flags: mark units with empty/near-empty text or image-only content for review (PRD §3)
- [ ] Study-guide ingestion path: parse into discrete `StudyGuideObjective` rows (numbered/bulleted split)
- [ ] Job status tracking + error surfacing per file; retry on a failed file
- [ ] Source viewer: browse extracted units per file, jump by index (backs provenance links later)
- [ ] Non-destructive re-ingestion: re-uploading a file updates source rows without touching `Flashcard` / `StudyProgress`
- [ ] Tests: fixture PDF + fixture PPTX (with notes and a table) assert extraction shape

**Exit criteria:** Upload a real deck + study guide; every slide is browsable by index with its notes, and objectives are listed as discrete rows.

---

## Phase 2 — Atomic Flashcard Generation (PRD §2, §3, MVP #2)

- [ ] Anthropic client wrapper with strict JSON-schema tool output (ARCHITECTURE principle #2)
- [ ] Chunking strategy: group source units into generation batches within token budget
- [ ] Atomization prompt: discrete sub-questions per concept (origin, trigger, target, action, feedback pattern)
- [ ] Process-card prompt: step, sequence, mechanism, and full-summary card variants
- [ ] Provenance enforcement: reject any card missing `source_slide_id` + verbatim excerpt
- [ ] `CardRubric` generation (essential / optional points, common misconceptions)
- [ ] Deduplication pass across batches preserving distinct nuances
- [ ] Source-vs-AI-supplement badging on `full_explanation`
- [ ] Generation run UI: progress, per-batch errors, resumable
- [ ] Non-destructive regeneration: append/merge proposals, never wipe existing card IDs

---

## Phase 3 — Coverage Matrix (PRD §3, MVP #3)

- [ ] Map cards → objectives; write `CoverageMapping` rows with status
- [ ] Secondary AI review pass for omissions
- [ ] Coverage checklist UI: per objective, status + card count + slide range ("Covered by 6 cards via Slides 15–19")
- [ ] Gap view: objectives with no supporting source material, flagged explicitly
- [ ] Conflict detection: contradicting statements across files surfaced, not silently resolved

---

## Phase 4 — Normal Flashcard Mode (PRD §4, MVP #4)

- [ ] Flip/reveal card UI: concise answer + expandable detail, keyboard shortcuts
- [ ] "Show original slide" provenance drawer
- [ ] In-place question/answer editing → sets `is_user_edited`
- [ ] Filtering: topic, starred, missed, full deck; shuffle vs. structured order
- [ ] Grading inputs: Missed / Difficult / Easy
- [ ] Exact session resumption state

---

## Phase 5 — Adaptive Learn Mode (PRD §5, MVP #5)

- [ ] Round builder: 5–8 concepts per micro-round (user-configurable)
- [ ] Scaffolding ladder: MCQ recognition → immediate typed recall → interleaved re-prompt after 3–5 items → same-session delayed check
- [ ] MCQ distractor generation from sibling deck concepts; randomized placement, length-matched
- [ ] "I guessed" control; post-answer debrief on why a distractor fails
- [ ] Mastery safeguards: typing straight after a reveal does not register mastery
- [ ] Skip-ahead to typed recall for known concepts
- [ ] Persistent-error path: simplified explanation / sub-concept breakdown

---

## Phase 6 — Semantic Typed-Answer Grading (PRD §7, MVP #6)

- [ ] Grading endpoint: strict JSON verdict against `CardRubric`
- [ ] Synonym, abbreviation, and minor-typo tolerance
- [ ] Strict gates: directionality (increase vs. decrease) and mechanism (synthesis vs. secretion) errors fail
- [ ] Per-criterion rubric feedback: points met vs. missed, mandatory vs. peripheral
- [ ] "My answer was correct" student override + inline Q/A edit
- [ ] Practice-missed-sub-points flow
- [ ] Grading regression fixtures (known answer/verdict pairs)

---

## Phase 7 — Multi-Day Spaced Review (PRD §6, MVP #7)

- [ ] SRS scheduler: adaptive intervals writing `interval_days` / `next_review_due` / `last_grade`
- [ ] State machine: unstudied → recognition → immediate_recall → retained
- [ ] Separate tracking axes: Recognition, Immediate Recall, Multi-Day Retention
- [ ] Invalid-signal discard: guesses, hints, post-reveal typing excluded from independent-recall credit
- [ ] Granular partial credit: missing one sub-point does not reset mastered sub-points
- [ ] Missed-day handling without deck reset
- [ ] Due-today queue on the exam dashboard

---

## Phase 8 — MVP Hardening

- [ ] Responsive pass: desktop / tablet / mobile
- [ ] Continuous autosave + undo for card edits
- [ ] Export / backup of an exam (cards + progress) as JSON
- [ ] Empty, loading, and error states across all routes
- [ ] End-to-end smoke test: upload → generate → coverage → learn → review-due

---

## Deferred (post-MVP, tracked in PRD but out of MVP scope)

DOCX and note-image ingestion with OCR (§1) · diagram/pathway practice (§10) · practice exam mode (§11) · exam-date planning and load management (§12) · full progress analytics dashboard (§13) · in-session scaffolding buttons (§14) · full undo history (§15).
