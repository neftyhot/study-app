/**
 * Compiles the Electron main process to V8 bytecode (LICENSING_SPEC §5).
 *
 * Two steps, and the order matters:
 *
 *  1. **Bundle.** The main process and everything it requires locally — the
 *     license verifier, the store, the gate — become one CommonJS file.
 *     Bytenode compiles a file, not a module graph, and rewriting every
 *     `require("./license/gate.cjs")` to point at a `.jsc` would be fragile.
 *     Node's builtins and the native/heavy packages stay external.
 *
 *  2. **Compile with Electron's own Node.** V8 bytecode is only loadable by
 *     the V8 that produced it. Compiling with the system Node would produce a
 *     file the shipped app cannot read, and the failure would appear at
 *     launch, on someone else's machine. So this script runs under Electron:
 *     started with plain `node`, it starts itself again under Electron.
 *
 *     The same goes for the platform. Bytecode is only trusted on the OS and
 *     architecture that made it, so `--platform=win32` on a Mac cannot produce
 *     it. That build ships the minified bundle instead, with a warning; a
 *     release for Windows is compiled on Windows.
 *
 * This raises the cost of reading the licensing logic. It does not make it
 * impossible — bytecode can be disassembled, and anyone determined enough will
 * get there. It is a lock on a door, not a vault.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(import.meta.url);

const { values: args } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
  },
});
const crossBuild = args.platform !== process.platform || args.arch !== process.arch;

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "electron", "build");
const BUNDLE = join(OUT_DIR, "main.bundle.cjs");
const BYTECODE = join(OUT_DIR, "main.jsc");
const LOADER = join(OUT_DIR, "main.cjs");

/** Packages that must stay external: native, huge, or resolved at runtime. */
const EXTERNAL = [
  "electron",
  "better-sqlite3",
  "node-llama-cpp",
  "next",
  "node-machine-id",
  "bytenode",
];

/**
 * The Google OAuth client, baked into the bytecode.
 *
 * A student's machine has no .env.local, so the packaged main process could
 * not otherwise know which OAuth client to sign in with. Google treats a
 * Desktop client's secret as non-confidential — it ships in every installed
 * app that uses one — so embedding it is the documented arrangement, not a
 * leak. A build without them still works; sign-in says it is unconfigured.
 */
function oauthDefines() {
  try {
    process.loadEnvFile(join(ROOT, ".env.local"));
  } catch {
    // No .env.local: rely on the build environment.
  }

  const defines = {};
  for (const name of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) {
    const value = process.env[name]?.trim();
    if (value) defines[`process.env.${name}`] = JSON.stringify(value);
    else console.warn(`${name} is not set; this build cannot sign in with Google.`);
  }

  // Where purchased keys are collected from (workers/licensing). A public
  // URL, not a secret.
  const server = process.env.LICENSE_SERVER_URL?.trim();
  if (server) defines["process.env.LICENSE_SERVER_URL"] = JSON.stringify(server);
  else console.warn("LICENSE_SERVER_URL is not set; purchased keys must be pasted in by hand.");
  return defines;
}

/**
 * Runs this script again under Electron's Node, and exits with its status.
 *
 * Done here rather than as `ELECTRON_RUN_AS_NODE=1 electron …` in
 * package.json, which is shell syntax Windows' cmd.exe does not understand.
 */
function rerunUnderElectron() {
  // Outside Electron, the `electron` package exports the binary's path.
  const electron = require("electron");
  const result = spawnSync(
    electron,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

async function main() {
  if (!process.versions.electron) return rerunUnderElectron();

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  await build({
    entryPoints: [join(ROOT, "electron", "main.cjs")],
    outfile: BUNDLE,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: `node${process.versions.node.split(".")[0]}`,
    external: EXTERNAL,
    define: oauthDefines(),
    logLevel: "warning",
  });

  // The verifier reads its public key relative to __dirname, and __dirname
  // moves when the file is bundled — so the key travels with the bundle.
  copyFileSync(
    join(ROOT, "electron", "license", "license-public-key.pem"),
    join(OUT_DIR, "license-public-key.pem"),
  );

  // Same for the preload and the activation screen, which the bundled main
  // process loads by path.
  for (const asset of ["preload.cjs", "app-preload.cjs", "activation.html"]) {
    copyFileSync(join(ROOT, "electron", asset), join(OUT_DIR, asset));
  }

  if (crossBuild) {
    // No bytecode this V8 could make would load there; ship the source,
    // minified. Readable with effort, which is why a release is not built so.
    await build({
      entryPoints: [BUNDLE],
      outfile: LOADER,
      minify: true,
      platform: "node",
      format: "cjs",
      logLevel: "warning",
    });
    rmSync(BUNDLE, { force: true });
    console.warn(
      `Building for ${args.platform}-${args.arch} on ${process.platform}-${process.arch}: ` +
        "the main process ships minified, NOT as bytecode.\n" +
        `Compile on ${args.platform}-${args.arch} for a release build.`,
    );
    return;
  }

  const bytenode = require("bytenode");
  bytenode.compileFile({ filename: BUNDLE, output: BYTECODE });

  writeFileSync(
    LOADER,
    [
      "// Generated by scripts/compile-main.mjs — do not edit.",
      "// The main process ships as V8 bytecode; this is the two lines that load it.",
      'require("bytenode");',
      'require("./main.jsc");',
      "",
    ].join("\n"),
  );

  // The bundle is the readable source of the bytecode; shipping it alongside
  // would make the whole exercise pointless.
  rmSync(BUNDLE, { force: true });

  console.log(`Compiled main process -> ${BYTECODE.replace(ROOT, ".")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
