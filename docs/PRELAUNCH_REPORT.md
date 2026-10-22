# Pre-launch report

Branch `prelaunch`, one commit per phase. Recon is in `docs/RECON.md`.

| Phase | Commit | What |
| --- | --- | --- |
| 1 | `f210a2b`, `f61a8d0` | Sample deck, key on demand, funnel telemetry, launch splash, pre-update backup |
| 2 | `3401b1b` | Decluttered Settings and deck page, Math help, what's-new |
| 3 | `aaa7eb9` | Deck sharing, read aloud, readable font, reminders, scans, accessibility |
| 4 | `5ee975d` | Campus-launch safeguards, landing page, signing review |
| 5 | `03c89c6` | iOS app on a shared core |
| 6 | `eadcb28` | Verification, upgrade and no-key walkthroughs, this report |
| Follow-up | this commit | iPhone in-app updates, Make a deck on iOS, Share deck menu item |

Nothing was deleted. Things that moved went under an Advanced disclosure, the
deck page's Customize section, or appear only when relevant. Licensing logic
(trial, purchase, the 45-day check, offline grace), the privacy policy
version, daily and pre-update backups, and every keyboard shortcut are
unchanged.

## Checks (Phase 6, on `03c89c6` + this commit)

| Check | Result |
| --- | --- |
| `tsc --noEmit` (desktop + core) | pass |
| `eslint .` (desktop, core, mobile) | 0 errors; 1 pre-existing warning in `workers/licensing/src/catalog.ts` (untouched file) |
| `vitest run` | 84 files, 1105 tests, all pass |
| `npm run smoke` (real pipeline, stubbed AI) | pass, 10 steps |
| `next build` (production) | pass |
| `npm run electron:compile` | pass |
| `npm --prefix mobile run typecheck` / `mobile:build` | pass |
| `npm run mobile:sync` + unsigned `xcodebuild` for the iPhone 18 Pro simulator | BUILD SUCCEEDED |
| Fresh install on the simulator | Wordmark settles into the top-left; Home shows the sample deck (44 cards) |

## Walkthroughs

1. **Fresh install → sample deck → Learn, no key.** Smoke step 10 adds the
   sample deck, checks that a second open reuses it, runs a Learn round and
   marks a typed answer with the keyword grader (the no-key path). On iOS this
   was done by hand in the simulator. On desktop, the splash, privacy screen
   and trial screen are UI only, so they're in the manual steps below.
2. **Key → PDF → generate → Study now.** Smoke steps 1–9 cover ingesting slides,
   a study guide PDF and Word notes, generating, coverage, Learn, grading,
   the due queue and export. They use a stub AI provider. No real key was used.
3. **An old database upgrades.** `src/db/migrations.test.ts`, "keeps a
   last-release library whole", builds a database at the shipped schema
   (through 0030) and fills it with a starred card, scheduling progress, a
   session with card grades, an answer attempt, a card revision and a
   setting. After running today's migrations, it reads everything back
   through the current schema. Nothing is lost, and the new columns default
   sensibly: not deleted, not from a scan.
4. **Every pre-existing feature is reachable.** See the next section.

## Feature reachability

This was checked against the in-app feature list,
`tools/license-manager/features.js` (22 areas, about 175 entries, shown in
the License Manager's Features tab). Every `where:` path in it exists.

- **Nothing was removed.** Between `eabe12e` and this branch, no file under
  `src/app` or `src/components` was deleted, and no component was left
  unimported. The changes are only additions: scan, share, reminders and
  share-import routes, the fonts, and 8 new components.
- **Every keyboard shortcut is still there.** Every `key ===` and `case`
  handler from the last release was compared with this branch: flashcard
  Space/Enter, 1–3, Z, S and K; practice-exam 1–4 and A–D. The only change is
  the new R (read aloud).
- **Where things moved:**

  | Feature | Where it is now |
  | --- | --- |
  | Generate cards, page ranges, density, scope | Deck page → **Customize**. It's open when the deck has no cards or a run is going; otherwise use the Customize button |
  | Coverage check, conflicts | Customize, or deck ••• → Study-guide check (needs a study guide) |
  | Files, study plan, export, remove repeats, reset, delete | Deck ••• menu, as before |
  | Other AI providers, model level, speed-up guide, grading strictness, offline models | Settings → **Advanced AI settings** (open by itself while an offline model is in use or downloading) |
  | Delete statistics, license ID, crash log | Settings → **Advanced** |
  | Numbers panel + calculator | Merged into **Math help** on cards that have numbers. Cards without numbers show a plain **Calculator** button |
  | "Add your key" banner | Shows once the student first uses an AI feature, instead of on first launch |
  | What's new banner | Shown once per update, not on a fresh install |

- **One regression was found and fixed in this phase.** After Phase 2, cards
  with no numbers had no calculator in Flashcards, Learn or the study guide,
  because Math help only appears where there are numbers. `NumbersPanel` now
  falls back to a quiet Calculator button, which matches the catalog's
  "Calculator on every card". Practice exams always had one.
- Features with no button of their own still run automatically: import
  parsers, SRS, backups, the updater, the license check, privacy and
  telemetry. "Check again" for the license is still in the Electron gate
  window.

## Unfinished, and why

- **iOS purchasing.** Not built, as the plan said. The three options are in
  `docs/MOBILE_ARCHITECTURE.md` §6. The recommendation for now is a free
  companion app.
- **Sync.** Design only (§7). The recommendation is a file-based change log.
  The schema is already sync-ready (0031).
- **iOS features that wait for the desktop**, shown as "Available on desktop":
  lectures, the catalog, the study guide/primer, diagrams, drills, coverage,
  old .doc/.ppt files, and Google sign-in. The phone makes decks from
  PowerPoint, PDF, Word, text and CSV files (follow-up below), but without
  the desktop's page ranges, density and coverage options.
- **iOS show-original-slide** shows the card's source excerpt only. Slide
  images aren't stored on the phone.
- **iOS history.** The phone records progress, but not `answer_attempts` or
  `study_sessions` rows. The desktop analytics that read those won't see
  phone study until sync exists.
- **iOS Snap** makes one AI call per photo, with no batching yet.
- **iOS file picking** uses an HTML file input. It works with Files and
  iCloud Drive, but has no native document browser.
- **Reminders** differ by platform: on desktop they come from the running
  app; on iOS they're local notifications planned a week ahead.

## Follow-up: iPhone updates, Make a deck, Share deck

- **In-app updates on iOS** (`@capgo/capacitor-updater`, with stats off).
  The app checks GitHub prereleases tagged `ios-v…` at launch and from
  Settings → Updates. It verifies the zip's SHA-256, skips updates that need
  a newer native app, and rolls back if an update doesn't start. How to ship
  one: `docs/IOS_UPDATES.md`. Nothing has been published.
- **Make a deck on iOS** (Home → Make a deck). There are three ways in:
  - From a file. It uses the desktop's extractors, now in
    `packages/core/src/ingest`. Word goes through mammoth's browser build.
  - Paste text, either cards from Quizlet or Anki, or notes.
  - Type cards by hand.

  A Quizlet/Anki export or a two-column CSV becomes cards with no AI. Other
  files are split into batches of about 1,500 words, with a cost estimate
  shown first. A scanned PDF goes to Gemini as a document. Every path ends
  in a review list. Typed cards are saved row-for-row like the desktop's
  card editor (tested against `createManualCards`).
- **Desktop: Deck ••• → Share deck (.meganstudy file)**. A direct way into
  the existing export dialog, whose default format is already .meganstudy.

## Needs a human

- **Signing and notarisation.** See `docs/SIGNING_REVIEW.md`. Nothing is
  configured.
- **The real iOS bundle ID.** Replace `com.example.meganstudy` in
  `mobile/capacitor.config.ts`, in the Xcode target's Bundle Identifier, and
  in the deck UTI in `mobile/ios/App/App/Info.plist` (two places). Then pick a
  signing team in Xcode for device builds.
- **Launch screen on a real device.** The simulator shows about a second of
  black before the plain background colour. That's a simulator quirk, so
  confirm it on a phone.
- **Landing page.** `site/landing` isn't deployed. The iOS waitlist needs a
  real endpoint; it falls back to mailto until then.
- **App Store listing, privacy labels and screenshots** if the iOS app ships.

## Notes for reviewers

- The shared core is `packages/core`. Desktop `src/lib/*` files re-export it,
  and `src/lib/core-compat.ts` fails the typecheck if core's types drift from
  the database schema.
- The tutor's prompt logic moved into core, so desktop and iOS ask the same
  way.
- A misconception-field bug in the deck snapshot was fixed in passing.
- ESLint now covers `mobile/`.
- The iOS project uses Swift Package Manager. There is no CocoaPods and no
  `.xcworkspace`.
- Bundled fonts (Atkinson Hyperlegible and the cursive wordmark face) are
  under the OFL.
- `.gitignore`'s `data/` rule is now anchored to the repo root (`/data/`), so
  `mobile/src/data` is tracked. `*.db` is still ignored everywhere.

## Manual test steps

### Desktop

1. Quit the app. Move `~/Library/Application Support/Megan Study` aside
   (don't delete it), then run `npm run electron:dev`.
2. The splash wordmark should be cursive and settle into the top-left. With
   Reduce Motion on (System Settings → Accessibility → Display), it should
   simply appear.
3. Accept the privacy screen. The trial should start, with no keychain
   prompt.
4. Open the sample deck → Learn. Answer a typed question. It should be
   marked by key points, with a note that a key marks on meaning.
5. Settings → AI: add a key. Make a new deck → Customize → add a PDF →
   Generate → **Study now**.
6. Quit, put the old `Megan Study` folder back, and relaunch. Your cards,
   stars and history should all be there.
7. Try the shortcuts on a card: Space/Enter flip, 1–3 grade, Z undo, R read
   aloud, S star. In Learn: 1–4, Enter, K.
8. Deck ••• → **Share deck (.meganstudy file)**, then double-click the file in
   Finder. It should import as a copy.

### iOS simulator

1. `npm run mobile:sync`, then `npm run mobile:open`. This opens
   `mobile/ios/App/App.xcodeproj`.
2. Pick the **App** scheme and an iPhone simulator, then press ⌘R. No signing
   is needed for the simulator.
3. Splash → Home shows the sample deck. Open it → Flashcards. Then Learn
   without a key.
4. Settings → add a key → Tutor → ask about "card 3" → **Make cards from
   this**.
5. Home → **Make a deck** → **Type cards**, fill two cards, Done, Save.
   Then **Paste text** with a Quizlet export (term, tab, definition per
   line) → **These are cards**. With a key, try **From a file** with a
   .pptx from Files.
6. Home → **Snap your notes**. The simulator has no camera, so use the photo
   picker.
7. Turn on reminders, then check the notification permission prompt.
8. Run on an iPad simulator to see the two-column layout.
9. For a real device: Xcode → target App → Signing & Capabilities → choose
   your team. Change the bundle ID first (see above).
