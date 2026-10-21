# Reconnaissance: pre-launch plan vs. the code

Written before any pre-launch change, on branch `prelaunch` (base `71e7dc0`).
Where the plan and the code disagree, the code wins; every disagreement is
listed in the last section.

## 1. Structure

| Area | Where |
|---|---|
| Desktop shell | `electron/` — `main.cjs` (window, license gate, IPC), `app-preload.cjs` (`window.studyApp`), `preload.cjs` (activation window), `backup.cjs`, `updater.cjs` (Mac DMG swap), `lectures.cjs` (whisper.cpp), `license/` |
| Web app | `src/app/` — Next.js 16 App Router; API routes under `src/app/api/` |
| UI | `src/components/` — shadcn/radix primitives in `ui/`, feature folders (study, learn, exam, primer, manage, catalog, settings, lectures, layout…) |
| Logic | `src/lib/` — srs, learn, exam, grade, plan, cards, generate, primer, llm, catalog, manage, export, telemetry, settings |
| DB | `src/db/schema.ts`, `src/db/client.ts`, migrations in `drizzle/` (0000–0030) |
| Backend | `workers/licensing/` (license, catalog, telemetry, insights — Cloudflare Worker), `workers/site/` (download page, Worker `megan-study`) |
| Dev tools | `tools/license-manager/` (separate Electron app) |
| Docs | `docs/ARCHITECTURE.md` (partly stale), `PRD.md`, `LICENSING*.md`, `TASKS.md` |

There is no sidebar; the layout is a sticky header (`site-header.tsx`) over a
centered `<main>` (`max-w-(--content-width)`).

## 2. Data storage

- SQLite through better-sqlite3 + Drizzle 0.45. Database file in
  `userData/data/study-app.db`.
- Every primary key is a UUID text (`id()` helper, `schema.ts:31`); `createdAt`
  is ISO text. **`updatedAt` exists only on** flashcards (nullable),
  study_sessions, app_settings, google_oauth_sessions, diagram_occlusions,
  generation_jobs, tutor_chats and lecture_transcripts. **No soft delete**:
  deletes cascade.
- Migrations: drizzle-kit (`npm run db:generate`) writes `drizzle/NNNN_*.sql`.
  - Production: `migrate()` in `electron/main.cjs` (~L179) first calls
    `backupDatabase` (a daily copy, 7 kept) and then runs the Drizzle migrator
    against `.next/standalone/drizzle`.
  - Dev: `npm run db:migrate` (`src/db/migrate.ts`).
- Tests use `new Database(":memory:")` + `migrate(db, {migrationsFolder:"./drizzle"})`
  (see `src/lib/ingest/relink.test.ts`). **There is no old-database upgrade test.**
- Secrets: API keys are sealed by `src/lib/secret-box.ts`.
  - `enc:v1` is Electron safeStorage; on macOS `enc:v2` is AES-GCM with the key
    file `local-secret.key` beside the DB, so there is no keychain prompt.
  - Under `next dev`, keys are stored as plain text.
- Backups: daily at launch only. **No pre-update backup exists** (see section 6).

## 3. Next.js inside Electron

- Production:
  - The main process `require`s the standalone Next server and serves it on a
    random free port on 127.0.0.1.
  - Every request carries the launch secret header `x-study-app-launch`;
    `src/proxy.ts` returns 403 without it.
  - The window shows on `ready-to-show` with background `#0a0a0a`.
- Dev: `npm run electron:dev` runs `db:migrate` and `next dev`, then Electron
  loads `localhost:3000`. In dev, Electron skips migrations and the server.
- Main-process code is bundled by `scripts/compile-main.mjs` (esbuild +
  bytenode). Any new file loaded by path (preload, HTML) must be added to its
  asset copy list.
- IPC to the renderer goes through `window.studyApp` (`app-preload.cjs`,
  checked by `fromApp()`); its types live in `src/main/auth/ipc.ts`.
- The license gate runs before the window opens:
  - `electron/license/gate.cjs`: `TRIAL_DAYS = 7`, `CONFIRM_DAYS = 45`.
  - A fresh install starts the trial automatically.
  - `activation.html` appears only when the license is invalid.
  - **Out of scope for changes.**
- Not present today:
  - single-instance lock, `open-file`/`second-instance` handling and
    `fileAssociations`;
  - Notification, login items and Tray;
  - a splash screen.

## 4. AI calls

Every call goes through `getProvider(override?, role)` in
`src/lib/llm/index.ts`.

- **Roles:** bulk, interactive, primer, grade.
- **Wrappers:** `guardProvider` (remote kill switch) and `meterProvider` (the
  numbers-only usage log).
- **Gemini is the default** (`gemini-3.8-flash`, falling back to 3.5-flash).
  Anthropic, OpenAI and local (node-llama-cpp) are also supported.
- **Retries and fallback:** `src/lib/llm/fallback.ts`.
- **Tiers:** Standard/Thinking in `src/lib/llm/tiers.ts`.

| Trigger | File | With no key today |
|---|---|---|
| Card generation | `api/exams/[examId]/generate/route.ts` | 503 `{error}` |
| Explain | `api/cards/[cardId]/explain/route.ts` | 503, toast |
| Study guide | `api/exams/[examId]/primer/route.ts`, `api/primer/{example,counter-example}` | 503 |
| Coverage | `api/exams/[examId]/coverage/route.ts` | 503 |
| Tutor | `lib/tutor/actions.ts` | `{ok:false,error}` |
| Search (semantic) | `lib/search/actions.ts` | `{ok:false,error}` |
| Practice exam | `lib/exam/actions.ts` | Paper is set anyway (`soft()`); typed answers use the keyword grader |
| Learn, typed grading | `lib/grade/index.ts` `getTypedGrader` | Local Qwen grader if installed, else the keyword grader (`provisional: true`) with a hint |
| Learn, diagnosis and help | `lib/learn/actions.ts` | Silently falls back / `{error}` |
| Diagrams, lectures | — | No LLM |

- Key check: `checkGeminiKey` in `settings-actions.ts` (Gemini only).
  `confirmGeminiKey` in `gemini-key-steps.tsx` wraps it on the client.
- Dashboard nudge: `needsKey` in `src/app/page.tsx`.

## 5. Commands

| Purpose | Command |
|---|---|
| Typecheck | `npm run typecheck` (`tsc --noEmit`) |
| Lint | `npm run lint` (eslint; ignores `electron/**`, `tools/**`) |
| Tests | `npm test` (vitest, node env, `src/**/*.test.ts` and `workers/**/src/**/*.test.ts`) |
| Web build | `npm run build` |
| Main-process build | `npm run electron:compile` |
| Desktop package | `npm run electron:build` / `electron:pack`; Windows `build:win` |
| Migrations | `npm run db:generate`, `npm run db:migrate` |

## 6. Where the plan and the code disagree

1. **Framer Motion is not a dependency.** The animations use CSS and the Web
   Animations API, as the plan allows. `tw-animate-css` is present.
2. **Reduced motion** is honored only in `card-formats.tsx`. A global rule
   must be added.
3. **No pre-update backup exists.** The plan says to "leave it intact". Only
   the daily launch backup exists. Phase 1 adds one in `updater.cjs` before
   the DMG swap; the Windows updater does not exist.
4. **Telemetry is one hourly aggregate report per install, not an event
   stream** (`src/lib/telemetry.ts`, worker `insights.ts`). Funnel "events"
   become a map of event name to count or first-seen flag inside that report,
   and the worker's sanitizer is extended.
5. **Catalog auto-hide and admin moderation already exist.**
   - `workers/licensing/src/catalog.ts` has `LIMITS.reportsToHide = 3`, and
     the `/admin/catalog` hide/restore/ban/delete routes sit behind
     ADMIN_TOKEN.
   - Phase 4 only surfaces this and adds the client-side publish checkbox.
6. **Lectures already exist.** Recording, local whisper transcription and a
   nav entry are in place. They only need a Beta label and the acknowledgement
   from Phase 4.
7. **No JSON restore import exists.**
   - The JSON backup (`src/lib/manage/export.ts`, `EXPORT_VERSION=1`) carries
     no images and no study guide.
   - `.meganstudy` therefore needs a new format and importer. The model for
     inserting a whole deck is `addToMyDecks` in `src/lib/catalog/store.ts`.
8. **No soft delete; `updatedAt` is inconsistent.** A migration adds
   `updated_at` and `deleted_at` where they are missing. Reads are not changed
   to filter soft-deleted rows yet, since there is no sync.
9. **No file-type registration or single-instance lock** in Electron.
10. **Signing.** The app is unsigned:
    - no `hardenedRuntime`, entitlements, notarize config, `afterSign` or
      Windows certificate;
    - `electron/README.md` says `asar: false`, but the config has `asar: true`.
11. **Xcode is not installed** (only Command Line Tools). The iOS simulator
    build cannot run here.
12. **Settings has no fallback-model UI and no usage-log viewer.**
    - Fallback is automatic, and the usage log feeds only telemetry.
    - The plan's Advanced list keeps what exists and notes these two as
      absent.
13. **The "What's new" banner** is tracked in localStorage and also shows on
    a brand-new install. Phase 2 suppresses it on the first run.
14. **The setup wizard** (`/welcome`) has choose, api and local steps, plus
    "Skip for now". It is reached by a redirect in `src/app/page.tsx`, not in
    the layout. The privacy gate replaces the whole app until accepted, and the
    trial starts automatically in main before the window opens. So the plan's
    "privacy → trial" order is already privacy (with the trial choice) →
    wizard.
15. **Learn has no "Were you right?" self-grade.** It has a "My answer was
    correct" override and a keyword fallback; the self-grade is new.
16. **There is no "recommended action" function.** The deck page picks a
    primary path step inline, which "Study now" builds on.
17. **Read aloud and bundled fonts do not exist.** `public/` holds only SVGs,
    and fonts come from `next/font/google`.
18. **`docs/ARCHITECTURE.md` is stale.** It names Claude as the default
    model; Gemini is.
19. **The marketing site** `workers/site/` (Worker `megan-study`) is separate
    from the new `/landing`. `/landing` is added as static files and nothing
    is deployed.
20. **Keyboard handlers to preserve:**
    - **Study deck:** Space, 1/2/3, ←/→, s, e, k, d.
    - **Diagram drill:** arrows, Enter/Space, 1/2.
    - **Calculator:** captures keys while open.
    - **Practice-exam options:** 1–9/A–I and arrows.
    - **Learn typed answer:** Enter / Shift+Enter.
    - Read aloud needs a key none of these use.
