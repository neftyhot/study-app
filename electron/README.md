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

## Native modules

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
