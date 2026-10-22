# Megan Study for iPhone and iPad

How the iOS app is built, what it shares with the desktop, what it leaves to
the desktop and why, and how to run it in Xcode. Written for Phase 5 of the
pre-launch plan; `docs/PRELAUNCH_REPORT.md` has what was tested.

## 1. Shape (5a)

```
packages/core/src      shared study logic — SRS, Learn ladder, grading, MCQ,
                       exams, guides, search, sharing format, tutor prompts,
                       Gemini provider, migrations runner, platform interfaces
src/                   desktop: Next.js 16 UI + server routes, Electron main
mobile/                iOS: Vite + React 19 in a Capacitor 8 shell
  src/platform/        the iOS (and browser-dev) answers to the interfaces
  src/data/            SQL over the same schema the desktop uses
  src/screens/         the iPhone/iPad screens
  ios/App/             the Xcode project (Swift Package Manager, no CocoaPods)
```

The iOS app is **Capacitor**: the web UI runs in WKWebView and talks to
native code through plugins. It is not a port of the desktop app — two things
the desktop depends on do not exist on iOS:

| Desktop piece | Why it can't run on iOS | What iOS does instead |
| --- | --- | --- |
| Next.js server routes (`src/app/api/*`: cards, decks, drills, exams, lectures, primer, reminders, share, slides) and server actions | No Node server inside an iOS app | The screens call `mobile/src/data/*` directly; the logic those routes wrapped lives in `packages/core` and is called in-process |
| Electron main process (`electron/`): safeStorage, file dialogs, LibreOffice, whisper/ffmpeg, local models, licensing checks, backups | No Electron, no child processes, no bundled binaries | Capacitor plugins behind the `Platform` interfaces (below); the features that need binaries are deferred |
| better-sqlite3 | Native Node addon | `@capacitor-community/sqlite` (SQLite in `Library/CapacitorDatabase`) |
| AI calls through the server | — | The Gemini provider from core, called from the app with the student's own key |

The desktop's Drizzle migrations are bundled into the iOS build
(`virtual:migrations` in `mobile/vite.config.ts`) and applied by the shared
runner (`packages/core/src/platform/migrate.ts`), so both apps always have the
same schema, and a `.meganstudy` file round-trips between them
(`mobile/src/data/data.test.ts`).

## 2. Shared core (5b)

`packages/core/src` is the code that used to be `src/lib/*` for everything
that does not touch Node, Electron or Next. The old `src/lib/...` files are
now one-line re-exports (`export * from "@megan/core/..."`), so every desktop
import still works and desktop behaviour is unchanged; the full desktop suite
passes. `src/lib/core-compat.ts` fails the desktop typecheck if core's copies
of the database types drift from `src/db/schema.ts`. iOS imports it as `@megan/core/...` (a Vite and
TypeScript alias to `packages/core/src`). There is no separate package build;
both sides compile the source.

## 3. Platform adapters (5c)

`packages/core/src/platform/types.ts` defines what the study logic needs from
a device. Each has a desktop and an iOS answer:

| Interface | Desktop | iOS (`mobile/src/platform/ios.ts`) |
| --- | --- | --- |
| `SqlDriver` (storage) | better-sqlite3 wrapper (`src/lib/platform/sqlite.ts`) | `@capacitor-community/sqlite` |
| `SecretStore` | safeStorage file (`src/lib/platform/secrets.ts`) | Keychain via `@aparajita/capacitor-secure-storage` (this device only, not iCloud-synced) |
| AI (`LlmProvider`) | Gemini / Claude / local models | Gemini with the same fallback chain (`mobile/src/platform/ai.ts`) |
| `FileAccess` | Electron dialogs | file input (Files app picker), `@capacitor/camera`, `@capacitor/share` |
| `Notifier` | in-app reminders while the app is open | `@capacitor/local-notifications`, scheduled a week ahead |
| `Speech` (read aloud) | Web Speech API | `@capacitor-community/text-to-speech` |
| `Haptics` | no-op | `@capacitor/haptics` |
| `LicenseProvider` | the existing trial/license code, untouched | `developmentLicense`: full access (see §6) |

`mobile/src/platform/web.ts` answers the same interfaces in a plain browser
(sql.js + localStorage) so `cd mobile && npm run dev` works without a
simulator. It never ships.

## 4. What iOS v1 has (5d)

- Courses and deck list, with the sample deck "Intro to Psychology: Memory" on first launch.
- Flashcards, including Swipe mode (right = easy, left = missed, undo).
- Learn with multiple choice then typed answers. With a key, typed answers are marked on meaning; without one, on key points.
- Practice exams.
- Study guides with citations. "Show original slide" shows the slide's text excerpt, because slide images are rendered on the desktop.
- Search and stars.
- Spaced repetition, using the same scheduler as the desktop, plus due-card reminders.
- Tutor, with a Gemini key. The deck's cards and their source excerpts are its material, and "Make cards from this" saves what was discussed.
- Themes, light and dark, the readable font and text size, and read aloud.
- The launch animation: the cursive wordmark, which then settles into the top-left corner. It sits inside the safe areas and honours Reduce Motion.
- `.meganstudy` import from the share sheet, the Files app or AirDrop (`mobile/src/share-intake.ts`), plus "Open a deck" on Home.
- "Snap your notes": photos or the camera, then cards you review before saving into a new deck. It needs a key and makes one request per photo.

**Deferred.** Each item is listed under Settings → "On the desktop app" and shows "Available on desktop" (`DESKTOP_ONLY_FEATURES`):

| Feature | Why it waits |
| --- | --- |
| Lecture recording and Whisper transcription | whisper-cli and ffmpeg are bundled binaries |
| Local AI models | model runtimes and weights |
| LibreOffice conversion | not possible on iOS |
| PowerPoint import | parsing and rendering are server-side |
| Image occlusion editor | needs a pointer-precise editor; the desktop one is mouse-first |
| Bulk editing | the desktop table editor |
| Catalog publishing | goes through the desktop's licensed account |

Decks made with any of these on the desktop still study normally on iOS once
they are shared over.

## 5. Layouts (5e)

- **iPhone** (narrower than 768 pt):
  - Bottom tabs: Home, Study, Search, Settings, each with its own navigation stack.
  - Tap targets are at least 44 pt.
  - Content is edge to edge and padded with `env(safe-area-inset-*)`, since `contentInset` is "never".
  - Text sizes are in `rem` and follow Dynamic Type through `-apple-system-body`, scaled by the in-app text size.
- **iPad**, and Split View at 768 pt or wider:
  - A sidebar replaces the tabs, with a split content area.
  - The tutor opens as a side panel beside the deck.
  - Hover states.
  - The desktop keyboard shortcuts work with a hardware keyboard. On flashcards: Space or Enter to flip, 1–3 to grade, ←/→ in Swipe, Z to undo, R to read aloud and S to star. In Learn: 1–4 to pick, Enter to continue and K for "I know this".
- Motion: every animation has a `prefers-reduced-motion` path. All colours come from the shared theme tokens (`virtual:theme.css`, generated from `packages/core/src/appearance.ts`).

## 6. Licensing on iOS (5f)

Built as option **C, unlock with a desktop license**. The App Store app is
free and sells nothing: no in-app purchase, no buy link, no price. Apple takes
nothing because nothing is bought in the app (App Review 3.1.3(b): an app may
unlock what was bought elsewhere as long as it doesn't point people there).

How the phone gets a key:

1. **From the computer.** The desktop writes its license token into its sync
   device file (`license` in `packages/core/src/sync/folder-sync.ts`; only
   bought or admin keys, never a trial). When the phone syncs, it takes the
   first token that checks out (`takeDesktopLicense` in `mobile/src/app.tsx`).
2. **Pasted in.** Settings → License takes a key, and a
   `meganstudy://license?token=…` link saves one. For someone who wants only
   the phone app: they buy on the web (the Payment Link). With no computer's
   id to bind to, the licensing Worker mints the key for `phone-<uuid>`, and
   its success page shows the key and an "Open in Megan Study" link.

The rules (`packages/core/src/license/companion.ts`) mirror the desktop's
`electron/license/verify.cjs` and `gate.cjs`, with one difference: a lifetime
key works on the phone whatever machine it was bought for.

- The Ed25519 signature is checked natively (`LicensePlugin.swift`, CryptoKit),
  since iOS 15's WebCrypto has no Ed25519. It uses the same public key as the desktop.
- 7-day trial from first open. Moving the clock back doesn't stretch it.
- Once a day the phone asks `GET /revoked/:id`. A revoked key locks the app,
  and so does a key the server hasn't confirmed in 45 days (admin keys excepted).
- State is kept in the Keychain (`megan_license`).
- Locked, the app shows `LockedScreen` (sync, or enter a key). Settings stays
  open, and nothing a student made is deleted.

For App Review: give the reviewer a license key in the review notes, and
describe the app as a companion to the desktop app.

The desktop's trial, purchase, 45-day check and offline grace are unchanged.

## 7. Two-way sync: design only (5g)

Not built. Today decks move between the two apps as `.meganstudy` files
(Share → AirDrop, Files or Messages). That is a copy, not a sync: progress and
stars stay on the device where they were made.

What sync has to carry: decks, cards and guides (rarely edited), plus card progress, review history and stars (written all the time, on both devices). Every row already has a UUID `id`, and the progress rows have `updated_at`. That is enough for last-writer-wins per row, plus a tombstone table for deletes.

| Approach | How | Estimate | For | Against |
| --- | --- | --- | --- | --- |
| **CloudKit** (private database) | iOS: CKSyncEngine through a small Swift plugin. Desktop: CloudKit JS / Web Services with an Apple ID sign-in. | 3–4 weeks | Free, private, no server to run, works offline | Windows desktop users need an Apple ID; CloudKit JS from Electron is awkward |
| **Small backend** (the existing Cloudflare Worker + D1) | A `/sync` endpoint that pushes and pulls changed rows since a cursor, keyed by license or account | 2–3 weeks, plus ongoing hosting and privacy-policy work | Works on Mac, Windows and iOS; one place to fix conflicts | Card content leaves the device. That needs a privacy-policy change, which this phase must not make, and accounts. |
| **File-based** (iCloud Drive or any synced folder) | Each device writes an append-only change log (`<device>.jsonl`) into a shared folder and merges the others' logs on launch | 1–2 weeks | No server, no accounts, nothing new leaves the device's own cloud | Slow to converge; Windows needs iCloud for Windows or Dropbox; a folder picker on both sides |

Recommendation: **file-based first**. It fits the privacy promise and needs no
accounts, and the change-log format carries over to a backend later if one is
needed.

## 8. The iOS project (5h)

Generated with `npx cap add ios` (Capacitor 8, Swift Package Manager; no
CocoaPods, no `.xcworkspace`). Scripts:

| Root | In `mobile/` | Does |
| --- | --- | --- |
| `npm run mobile:build` | `npm run build` | Vite build into `mobile/dist` |
| `npm run mobile:check` | — | typecheck + build |
| `npm run mobile:sync` | `npm run sync` | build, then copy into `ios/App/App/public` and update plugin packages |
| `npm run mobile:open` | `npm run open` | opens `mobile/ios/App/App.xcodeproj` in Xcode |
| `npm run mobile:ios` | `npm run ios` | sync, then build and run on a chosen simulator |

**Run it in the simulator** (no Apple account needed):

1. `cd mobile && npm install` (first time only).
2. `npm run mobile:sync` from the repo root.
3. `npm run mobile:open`, or open `mobile/ios/App/App.xcodeproj` in Xcode.
4. Let Xcode finish resolving packages. The first time takes a minute or two.
5. In the toolbar, pick the **App** scheme and an iPhone or iPad simulator, then press ⌘R.

After any change in `mobile/src` or `packages/core`, run `npm run mobile:sync` again and press ⌘R again.

From the command line, an unsigned build:

```sh
cd mobile/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 18 Pro' \
  CODE_SIGNING_ALLOWED=NO build
```

**Running on a real iPhone** needs signing, which is not set up in the repo:

1. In Xcode, open App target → Signing & Capabilities and choose your team. A free personal team works for your own device for 7 days.
2. Change the bundle identifier, because `com.example.*` won't sign.

**Before the first TestFlight build.** The placeholder `com.example.meganstudy` appears in four places. Change all four together:

1. `mobile/capacitor.config.ts`: `BUNDLE_ID`.
2. The Xcode target: General → Bundle Identifier (`PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj`).
3. `mobile/ios/App/App/Info.plist`: the exported type `com.example.meganstudy.deck`, under both `UTExportedTypeDeclarations` and `CFBundleDocumentTypes`.
4. Its owner, which must be the real id followed by `.deck`. Otherwise iOS won't offer "Open in Megan Study" for `.meganstudy` files.

**Native assets:**
- `AppIcon` is 1024 pt, made from `build/icon.png` and flattened onto white, because App Store icons can't have alpha.
- The launch screen is a plain colour: `LaunchBackground` is white in light mode and #0a0a0a in dark, which matches the theme background. The web splash then draws the wordmark.

**Info.plist additions:**
- The camera and photo library usage strings, for Snap your notes.
- The `.meganstudy` document type.
- `LSSupportsOpeningDocumentsInPlace` is false, so iOS copies incoming decks into the app's Inbox before the app reads them.
- `arm64` as the required device capability.
