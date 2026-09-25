/**
 * Prepares Next.js standalone output for packaging.
 *
 * `output: "standalone"` emits a server plus only the modules it traced, which
 * is what keeps the desktop bundle to a sane size. It does NOT copy the static
 * assets or `public/`, because a normal deployment serves those from a CDN —
 * a desktop app has no CDN, so they are copied in here.
 */
import { cp, mkdir, access, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

/**
 * The platform the app is being packaged for, which is not necessarily this
 * one: `--platform=win32 --arch=x64` prepares a Windows bundle on a Mac.
 * Native binaries are chosen for the target, never for the build machine.
 */
const { values: args } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
  },
});
const target = { platform: args.platform, arch: args.arch };
const crossBuild =
  target.platform !== process.platform || target.arch !== process.arch;

/** `@napi-rs/canvas`'s per-platform package; Windows and Linux name the ABI. */
function canvasBinding({ platform, arch }) {
  const abi = { win32: "-msvc", linux: "-gnu" }[platform] ?? "";
  return `@napi-rs/canvas-${platform}-${arch}${abi}`;
}

/** node-llama-cpp's binaries are `@node-llama-cpp/{mac,win,linux}-{arch}[-gpu]`. */
const LLAMA_PLATFORM = { darwin: "mac", win32: "win", linux: "linux" };

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!(await exists(standalone))) {
    throw new Error(
      'No standalone output. Run `next build` with output: "standalone" first.',
    );
  }

  // `next build` copies .env files into the standalone output, and anything in
  // there ships inside the app. Secrets (like a Stripe key) must never do that.
  for (const name of [".env", ".env.local", ".env.production", ".env.production.local"]) {
    await rm(join(standalone, name), { force: true });
  }

  await mkdir(join(standalone, ".next"), { recursive: true });
  await cp(join(root, ".next", "static"), join(standalone, ".next", "static"), {
    recursive: true,
  });

  if (await exists(join(root, "public"))) {
    await cp(join(root, "public"), join(standalone, "public"), {
      recursive: true,
    });
  }

  // Migrations are read at startup by the main process, from the app root.
  await cp(join(root, "drizzle"), join(standalone, "drizzle"), {
    recursive: true,
  });

  // Build-time packages the tracer picked up but the app must not ship.
  //
  // `electron` is the worst of these: its dist contains a whole Electron.app,
  // so packaging it puts Electron inside Electron — a quarter of a gigabyte of
  // duplication, and the framework symlinks inside it break the packager
  // outright (fs-extra resolves a relative symlink target against the working
  // directory, which cannot work for `Versions/Current/Squirrel`).
  for (const unwanted of ["electron", "electron-builder", "app-builder-lib"]) {
    await rm(join(standalone, "node_modules", unwanted), {
      recursive: true,
      force: true,
    });
  }

  // Native modules the tracer cannot follow.
  //
  // Next traces imports, so it copies these packages' JavaScript and stops
  // there — the llama.cpp binary is selected and loaded at runtime, so it is
  // invisible to static analysis. The traced copy of the Metal binding came to
  // 8 KB of a 14 MB package, which loads fine right up until someone picks the
  // offline model. Copying the real directories over the stubs fixes that.
  for (const native of [
    "@node-llama-cpp",
    "node-llama-cpp",
    // Skia, used to rasterize a page for a diagram drill. Same problem: the
    // platform binding is resolved at runtime, so the tracer never sees it.
    "@napi-rs/canvas",
    canvasBinding(target),
  ]) {
    const source = join(root, "node_modules", native);
    if (!(await exists(source))) continue;

    const destination = join(standalone, "node_modules", native);
    await cp(source, destination, { recursive: true, force: true });

    // `.bin` holds symlinks to CLI entry points. They are useless inside a
    // packaged app and the packager chokes on copying them, so they go.
    await rm(join(destination, "node_modules", ".bin"), {
      recursive: true,
      force: true,
    });
  }

  await copySqliteBinary();
  await assertNativeBindings();

  await scrubBuildPaths();

  console.log(
    `Standalone output prepared for packaging (${target.platform}-${target.arch}).`,
  );
}

/**
 * better-sqlite3's binary for the target.
 *
 * It ships N-API prebuilds for every platform, and N-API is stable across
 * Node and Electron, so nothing is compiled — the right file only has to be
 * there. The tracer copies the build machine's alone, which on a Mac building
 * for Windows is exactly the wrong one.
 */
async function copySqliteBinary() {
  const name = `${target.platform}-${target.arch}.node`;
  const source = join(root, "node_modules", "better-sqlite3", "prebuilds", name);
  if (!(await exists(source))) {
    throw new Error(`better-sqlite3 has no prebuilt binary for ${name}.`);
  }

  const prebuilds = join(standalone, "node_modules", "better-sqlite3", "prebuilds");
  await mkdir(prebuilds, { recursive: true });
  await cp(source, join(prebuilds, name));
}

/**
 * Refuses to package a bundle whose native pieces are for another platform.
 *
 * npm installs only this machine's optional per-platform packages, so a cross
 * build is missing the target's unless they were fetched on purpose. Better
 * to stop here than ship an app whose diagram drills and offline model fail
 * the first time a student tries them.
 */
async function assertNativeBindings() {
  const missing = [];

  if (!(await exists(join(standalone, "node_modules", canvasBinding(target))))) {
    missing.push(canvasBinding(target));
  }

  const llamaDir = join(standalone, "node_modules", "@node-llama-cpp");
  const prefix = `${LLAMA_PLATFORM[target.platform]}-${target.arch}`;
  const llama = (await exists(llamaDir)) ? await readdir(llamaDir) : [];
  if (!llama.some((name) => name === prefix || name.startsWith(`${prefix}-`))) {
    missing.push(`@node-llama-cpp/${prefix}*`);
  }

  if (missing.length === 0) return;

  const hint = crossBuild
    ? `\nBuild on a ${target.platform}-${target.arch} machine (a CI runner will do), ` +
      "where npm installs them."
    : "\nRun `npm install` to fetch them.";
  throw new Error(
    `Native packages for ${target.platform}-${target.arch} are not installed:\n` +
      missing.map((name) => `  ${name}`).join("\n") +
      hint,
  );
}

/**
 * Removes the build machine's absolute paths from the shipped server.
 *
 * Next records where it was built — `repoRoot`, `outputFileTracingRoot`,
 * `turbopack.root` — and those strings go out with the app. They are only
 * build metadata, but they publish the developer's home directory and
 * username to everyone who downloads it, which is nobody's business.
 */
async function scrubBuildPaths() {
  const root = process.cwd();
  const files = [
    join(standalone, "server.js"),
    join(standalone, ".next", "required-server-files.json"),
  ];

  for (const file of files) {
    if (!(await exists(file))) continue;

    // Windows paths appear JSON-escaped (`C:\\Users\\…`) as well as raw.
    const before = await readFile(file, "utf8");
    const after = before
      .split(JSON.stringify(root).slice(1, -1))
      .join("/app")
      .split(root)
      .join("/app");
    if (after !== before) await writeFile(file, after);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
