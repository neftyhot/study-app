/**
 * Fetches the two command-line tools the Lectures tab runs: `whisper-cli`
 * (whisper.cpp, speech to text) and `ffmpeg` (any recording to 16 kHz WAV).
 *
 * They are standalone executables that the main process spawns, not Node
 * addons, so nothing here is compiled against Electron. They land in
 * `vendor/audio-tools/<os>-<arch>/`, which electron-builder copies into the
 * app's resources as `audio-tools/` (`extraResources` in package.json), and
 * which `electron/lectures.cjs` reads directly in development.
 *
 *   node scripts/fetch-audio-tools.mjs [--platform=win32] [--arch=x64] [--force]
 *
 * whisper.cpp publishes Windows and Linux builds but none for macOS, so there
 * it is built from the same commit with CMake (`brew install cmake`, or set
 * CMAKE to its path). Every download is pinned by SHA-256.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";

const { values: args } = parseArgs({
  options: {
    platform: { type: "string", default: process.platform },
    arch: { type: "string", default: process.arch },
    force: { type: "boolean", default: false },
  },
});

/** electron-builder's `${os}` names, which the `extraResources` path uses. */
const OS = { darwin: "mac", win32: "win", linux: "linux" };
const os = OS[args.platform];
if (!os) throw new Error(`Unsupported platform: ${args.platform}`);

const key = `${os}-${args.arch}`;
const out = join(process.cwd(), "vendor", "audio-tools", key);
const exe = args.platform === "win32" ? ".exe" : "";

/* ---------------------------------------------------------------- whisper */

/** The whisper.cpp build these binaries come from, and its source commit. */
const WHISPER_TAG = "b5130";
const WHISPER_COMMIT = "927cfce34f31707e17f2bff35c349632fb9e2c3a";
const WHISPER_RELEASE = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}`;

const WHISPER_BUILDS = {
  "win-x64": {
    file: "whisper-bin-x64.zip",
    sha256: "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
  },
  "win-arm64": {
    file: "whisper-bin-win-cpu-arm64.zip",
    sha256: "799543b926ab5b6c2d60cab269a2092e0ae8d27820e9e15429e59de3699546fc",
  },
  "linux-x64": {
    file: "whisper-bin-ubuntu-x64.tar.gz",
    sha256: "53e7fd8b5764edad916b8848dd0af6abb1ff1d3b86c899e79c78652412536c32",
  },
  "linux-arm64": {
    file: "whisper-bin-ubuntu-arm64.tar.gz",
    sha256: "93532a0e3777f26f041ffa358ee77dd88b1a33a86847c1990745327ff335a5d6",
  },
};

/**
 * Of everything in an upstream archive, what `whisper-cli` loads: itself, the
 * whisper and ggml libraries (one ggml-cpu per processor generation, chosen at
 * run time) and OpenMP. The other programs, their tests and the libraries only
 * they use (SDL, llama, parakeet) stay behind.
 */
function whisperNeeds(name) {
  if (name === `whisper-cli${exe}` || name === "LICENSE") return true;
  if (/^(lib)?(whisper|ggml)[\w.-]*\.(dll|so(\.[\d.]+)?)$/.test(name)) return true;
  return /^libomp[\w.]*\.dll$/.test(name);
}

/* ----------------------------------------------------------------- ffmpeg */

/**
 * Static ffmpeg builds, as published for the `ffmpeg-static` package. There is
 * no Windows-on-ARM build; the x64 one runs there under emulation, which is
 * fast enough for decoding audio.
 */
const FFMPEG_RELEASE = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

const FFMPEG_BUILDS = {
  "mac-arm64": {
    name: "darwin-arm64",
    sha256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
    license: "cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2",
  },
  "mac-x64": {
    name: "darwin-x64",
    sha256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
  },
  "win-x64": {
    name: "win32-x64",
    sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
    license: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  },
  "win-arm64": {
    name: "win32-x64",
    sha256: "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77",
    license: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  },
  "linux-x64": {
    name: "linux-x64",
    sha256: "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa",
    license: "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903",
  },
  "linux-arm64": {
    name: "linux-arm64",
    sha256: "754a678672298bc68156adff58aa7385a592c2b30b1d0ae8750c45c915c4bac0",
  },
};

/* ---------------------------------------------------------------- helpers */

/** Changes whenever anything above does, so a stale folder is rebuilt. */
const STAMP = JSON.stringify({
  whisper: WHISPER_COMMIT,
  build: WHISPER_BUILDS[key]?.sha256 ?? "source",
  ffmpeg: FFMPEG_BUILDS[key]?.sha256,
});

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${argv.join(" ")} exited with ${result.status}`);
  }
}

/** Downloads `url`; refuses anything whose SHA-256 is not the pinned one. */
async function download(url, sha256) {
  console.log(`[audio-tools] ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256) {
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== sha256) {
      throw new Error(`${url}: expected sha256 ${sha256}, got ${actual}`);
    }
  }
  return bytes;
}

/** Unpacks a .zip or .tar.gz; bsdtar (macOS, Windows) reads both. */
function extract(archive, into) {
  mkdirSync(into, { recursive: true });
  if (archive.endsWith(".zip") && process.platform === "linux") {
    run("unzip", ["-q", archive, "-d", into]);
  } else {
    run("tar", ["-xf", archive, "-C", into]);
  }
}

/* ------------------------------------------------------------------ steps */

async function whisperPrebuilt(work) {
  const build = WHISPER_BUILDS[key];
  if (!build) throw new Error(`whisper.cpp publishes no build for ${key}.`);

  const archive = join(work, build.file);
  writeFileSync(archive, await download(`${WHISPER_RELEASE}/${build.file}`, build.sha256));
  const unpacked = join(work, "whisper");
  extract(archive, unpacked);

  // One folder inside: `Release/` in the zips, the archive's name in the tars.
  const inner = join(unpacked, readdirSync(unpacked)[0]);
  for (const name of readdirSync(inner).filter(whisperNeeds)) {
    // `dereference`: the Linux tars link libwhisper.so.1 to the real file.
    cpSync(join(inner, name), join(out, name === "LICENSE" ? "LICENSE.whisper" : name), {
      dereference: true,
    });
  }
  if (args.platform === "win32") copyWindowsRuntime();
}

/**
 * The upstream Windows build links the Visual C++ runtime dynamically and does
 * not ship it. A PC without the redistributable installed would fail to start
 * `whisper-cli.exe` at all, so the DLLs are placed beside it, which Microsoft
 * allows for exactly this. Taken from the build machine, so only when it is
 * the same kind of Windows as the target.
 */
function copyWindowsRuntime() {
  const wanted = ["msvcp140.dll", "vcruntime140.dll", "vcruntime140_1.dll", "vcomp140.dll"];
  if (process.platform !== "win32" || process.arch !== args.arch) {
    console.warn(
      `[audio-tools] Not building on ${key}: the Visual C++ runtime was not bundled. ` +
        "whisper-cli.exe will need the redistributable on the student's PC.",
    );
    return;
  }
  const system32 = join(process.env.SystemRoot ?? "C:\\Windows", "System32");
  for (const name of wanted) {
    const from = join(system32, name);
    // vcruntime140_1 and vcomp140 do not exist on ARM; whisper does not ask for them there.
    if (existsSync(from)) cpSync(from, join(out, name));
  }
}

/** macOS: one self-contained executable, Metal included, no dylibs. */
async function whisperFromSource(work) {
  const cmake = process.env.CMAKE || "cmake";
  if (spawnSync(cmake, ["--version"]).status !== 0) {
    throw new Error(
      "Building whisper-cli for macOS needs CMake. Install it (`brew install cmake`) " +
        "or set CMAKE to its path.",
    );
  }

  const tarball = join(work, "whisper.tar.gz");
  writeFileSync(
    tarball,
    await download(`https://github.com/ggml-org/whisper.cpp/archive/${WHISPER_COMMIT}.tar.gz`),
  );
  extract(tarball, work);
  const source = join(work, `whisper.cpp-${WHISPER_COMMIT}`);
  const build = join(work, "build");

  run(cmake, [
    "-S", source,
    "-B", build,
    "-DCMAKE_BUILD_TYPE=Release",
    `-DCMAKE_OSX_ARCHITECTURES=${args.arch === "x64" ? "x86_64" : "arm64"}`,
    "-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0",
    "-DBUILD_SHARED_LIBS=OFF",
    // Not tuned to the build machine: it has to run on every Mac of this kind.
    "-DGGML_NATIVE=OFF",
    // The Metal shaders go inside the executable instead of a file beside it.
    "-DGGML_METAL_EMBED_LIBRARY=ON",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_SDL2=OFF",
  ]);
  run(cmake, ["--build", build, "--config", "Release", "--target", "whisper-cli", "-j"]);

  cpSync(join(build, "bin", "whisper-cli"), join(out, "whisper-cli"));
  cpSync(join(source, "LICENSE"), join(out, "LICENSE.whisper"));
}

async function ffmpeg() {
  const build = FFMPEG_BUILDS[key];
  if (!build) throw new Error(`No static ffmpeg build for ${key}.`);

  const gz = await download(`${FFMPEG_RELEASE}/ffmpeg-${build.name}.gz`, build.sha256);
  writeFileSync(join(out, `ffmpeg${exe}`), gunzipSync(gz));
  // ffmpeg is GPL software run as a separate program; its licence travels with it.
  writeFileSync(
    join(out, "LICENSE.ffmpeg"),
    await download(`${FFMPEG_RELEASE}/${build.name}.LICENSE`, build.license),
  );
}

async function main() {
  const stamp = join(out, ".stamp");
  if (!args.force && existsSync(stamp) && readFileSync(stamp, "utf8") === STAMP) {
    console.log(`[audio-tools] ${key} is up to date.`);
    return;
  }

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "audio-tools-"));
  try {
    if (args.platform === "darwin") await whisperFromSource(work);
    else await whisperPrebuilt(work);
    await ffmpeg();

    if (args.platform !== "win32") {
      chmodSync(join(out, "whisper-cli"), 0o755);
      chmodSync(join(out, "ffmpeg"), 0o755);
    }
    for (const name of [`whisper-cli${exe}`, `ffmpeg${exe}`]) {
      if (!existsSync(join(out, name))) throw new Error(`${name} is missing from ${out}`);
    }
    writeFileSync(stamp, STAMP);
    console.log(`[audio-tools] ${key}: ${readdirSync(out).sort().join(", ")}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
