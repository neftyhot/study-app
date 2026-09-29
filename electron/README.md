# Desktop packaging

`npm run electron:dev` runs the Next.js dev server and opens it in an Electron
window. `npm run electron:build` produces a `.dmg` (macOS) or `.exe` (Windows)
in `release/`.

## Where data goes

The packaged app sets `DATABASE_URL` and `UPLOADS_DIR` to
`app.getPath('userData')/data` before anything touches the database. That
matters for two reasons: the application directory can be read-only, and on
macOS an update replaces the whole bundle — a database stored next to the code
would be deleted by an upgrade.

Migrations run in the main process before the server starts, so a fresh install
and an upgraded one both come up against a schema that matches the code.

## Offline

Every study mode, deck view, and review works with no network. Only card
generation and typed-answer grading call out, and only when asked. Without an
API key the app still runs: generation is refused with a clear message, and
typed answers fall back to the provisional keyword grader.

## API keys

Every cloud call is billed to the student's own key, pasted in Settings and
encrypted with `safeStorage` (`secret-box`). `GEMINI_API_KEY` and the other
environment keys are read only in development; the packaged app sets
`NODE_ENV=production` and ignores them.

"Sign in with Google" has been removed: its tokens were billed to the
developer's Cloud project. On startup `google-auth.cjs` deletes any stored
session and revokes its refresh token.

## Before distributing a build

`prepare-standalone.mjs` removes the build machine's absolute paths from
`server.js` and `required-server-files.json`. Next records where it was built
(`repoRoot`, `outputFileTracingRoot`, `turbopack.root`), and those strings ship
with the app — harmless to run, but they publish the developer's home directory
and username to everyone who downloads it.

Worth re-checking a `.dmg` before handing it out. Mount it and search:

    hdiutil attach "release/Megan Study-0.1.0-arm64.dmg" -nobrowse -readonly
    grep -ral "AIzaSy" "/Volumes/Megan Study 0.1.0-arm64"   # API keys
    find "/Volumes/Megan Study 0.1.0-arm64" -name ".env*"   # env files
    find "/Volumes/Megan Study 0.1.0-arm64" -name "*.db"    # someone's decks

All three should come back empty. `data/` is outside the `files` globs and the
settings database lives in the user-data directory, so none of it is packaged —
but a build that starts prerendering pages again could bake local state into
HTML, which is how a key hint escaped once already.

## What must not be packaged

Next's tracer pulls `node_modules/electron` into the standalone output, which
would put a whole 338 MB Electron.app inside the Electron app being built. It
also breaks the build outright: electron-builder copies symlinks with
`fs-extra.ensureSymlink(target, destination)`, and fs-extra resolves a relative
target against the working directory — so the framework link
`Squirrel -> Versions/Current/Squirrel` fails with ENOENT no matter what.
`prepare-standalone.mjs` removes it, along with the packager's own packages.

If a build ever fails with `ensureSymlink 'Versions/Current/Squirrel'`, look for
a symlink that got into the file set rather than at Electron itself:
`find .next/standalone -type l`.

## Native modules

`node-llama-cpp` selects and loads its llama.cpp binary at runtime, so the
tracer copies its JavaScript and stops — the traced copy of the Metal binding
came to 8 KB of a 14 MB package, which loads fine right up until someone picks
the offline model. `prepare-standalone.mjs` copies the real directories over
the stubs.

`better-sqlite3` v13 is built against N-API, which is ABI-stable across Node
and Electron, so its shipped prebuild loads in Electron unchanged — no native
rebuild step is needed (`npmRebuild: false`). This was verified rather than
assumed: Electron 44 opens a database and round-trips a query using the
binary inside `.next/standalone`.

The app ships unpacked (`asar: false`) because the Next standalone server
must `chdir` into its own directory to resolve its assets, and a process
cannot change directory into an asar archive.

If a future version of better-sqlite3 drops N-API, this needs an
`@electron/rebuild` step in a `beforePack` hook that also replaces the copy
inside `.next/standalone/node_modules`, which electron-builder does not see.
