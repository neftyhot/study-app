import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { SPLASH_BOOT_SCRIPT } from "../packages/core/src/launch/choreography";
import { bundleMigrations } from "../packages/core/src/platform/migrate";

const root = resolve(import.meta.dirname, "..");

/**
 * `virtual:migrations`: the desktop's drizzle migrations, read at build time.
 *
 * iOS has no `drizzle/` folder to read at runtime, so the journal and every
 * `.sql` file are baked into the bundle, hashed exactly as drizzle hashes
 * them. One schema, one set of migrations, two runners.
 */
function migrations(): Plugin {
  const id = "virtual:migrations";
  const drizzle = resolve(root, "drizzle");
  return {
    name: "megan-migrations",
    resolveId: (source) => (source === id ? "\0" + id : undefined),
    load(source) {
      if (source !== "\0" + id) return;
      const journal = JSON.parse(readFileSync(resolve(drizzle, "meta/_journal.json"), "utf8"));
      const list = bundleMigrations(
        journal,
        (tag) => readFileSync(resolve(drizzle, `${tag}.sql`), "utf8"),
        (text) => createHash("sha256").update(text).digest("hex"),
      );
      return `export default ${JSON.stringify(list)};`;
    },
  };
}

/**
 * `virtual:theme.css`: the desktop's theme tokens and launch-splash styles,
 * lifted from its globals.css so the two apps can never drift apart in
 * colour or in the launch animation.
 */
function theme(): Plugin {
  const id = "virtual:theme.css";
  const globals = resolve(root, "src/app/globals.css");
  return {
    name: "megan-theme",
    resolveId: (source) => (source === id ? "\0" + id + "?.css" : undefined),
    load(source) {
      if (!source.startsWith("\0" + id)) return;
      const css = readFileSync(globals, "utf8");
      // Top-level token blocks: `:root { ... }` and `.dark { ... }`, `.forest { ... }` …
      const blocks = css.match(/^(?::root|\.[a-z]+) \{[\s\S]*?^\}/gm) ?? [];
      const start = css.indexOf("/* ── Launch splash");
      const end = css.indexOf("/*\n * A visible focus ring");
      const splash = start >= 0 && end > start ? css.slice(start, end) : "";
      return [...blocks, splash].join("\n\n");
    },
  };
}

/**
 * The splash boot script, inline in <head> so it marks <html data-splash>
 * before the first paint: the same string the desktop layout uses.
 */
function splashBoot(): Plugin {
  return {
    name: "megan-splash-boot",
    transformIndexHtml: () => [{ tag: "script", children: SPLASH_BOOT_SCRIPT, injectTo: "head-prepend" }],
  };
}

export default defineConfig({
  plugins: [react(), migrations(), theme(), splashBoot()],
  resolve: {
    alias: { "@megan/core": resolve(root, "packages/core/src") },
  },
  server: { fs: { allow: [root] } },
  build: {
    outDir: "dist",
    target: "safari16",
    sourcemap: false,
  },
});
