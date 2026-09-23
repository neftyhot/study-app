/**
 * Collects every feature suggestion sent from the app into feedback.txt.
 *
 *   npm run feedback:pull
 *
 * Suggestions live in the licensing Worker's KV under `feedback:` (see
 * workers/licensing/src/index.ts). This reads them with wrangler, so it uses
 * the Cloudflare login you deploy with — there is no admin endpoint to guard.
 * The file is rewritten from scratch each time, oldest first.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKER = join(ROOT, "workers", "licensing");
const OUT = join(ROOT, "feedback.txt");

function wrangler(...args) {
  return execFileSync("npx", ["wrangler", "kv", "key", ...args, "--binding", "LICENSES", "--remote"], {
    cwd: WORKER,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

const keys = JSON.parse(wrangler("list", "--prefix", "feedback:"))
  .map((entry) => entry.name)
  .sort();

const blocks = keys.map((key, index) => {
  let entry;
  try {
    entry = JSON.parse(wrangler("get", key, "--text"));
  } catch {
    return `#${index + 1} (unreadable: ${key})`;
  }
  const meta = [
    new Date(entry.receivedAt).toLocaleString(),
    entry.version ? `v${entry.version}` : null,
    entry.contact ? `from ${entry.contact}` : null,
  ].filter(Boolean);
  return `#${index + 1} · ${meta.join(" · ")}\n${entry.text}`;
});

writeFileSync(
  OUT,
  `Study App feature suggestions — ${keys.length} as of ${new Date().toLocaleString()}\n\n` +
    blocks.join(`\n\n${"-".repeat(60)}\n\n`) +
    "\n",
);
console.log(`Wrote ${keys.length} suggestion(s) to ${OUT}`);
