/**
 * The theme engine: the AAA styles as the stylesheet actually ships them, the
 * saved choice in the database, and the script that applies it before paint.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import {
  AAA_TEXT_CONTRAST,
  AAA_THEME_IDS,
  contrast,
  MIN_ACCENT_CONTRAST,
  THEME_IDS,
  THEME_STORAGE_KEY,
  themeBootScript,
  THEMES,
} from "@/lib/appearance";
import { readSetting, readTheme, writeSetting, writeTheme } from "@/lib/settings";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** The custom properties of one `.theme { … }` block. */
function themeVars(theme: string): Record<string, string> {
  const block = CSS.match(new RegExp(`^\\.${theme} \\{([^}]*)\\}`, "m"));
  if (!block) throw new Error(`no .${theme} block in globals.css`);
  return Object.fromEntries(
    [...block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
  );
}

describe("the AAA styles in globals.css", () => {
  it.each(AAA_THEME_IDS)("%s holds every text colour to 7:1", (theme) => {
    const v = themeVars(theme);
    const pairs: [string, string][] = [
      ["foreground", "background"],
      ["foreground", "card"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["muted-foreground", "muted"],
      ["muted-foreground", "background"],
      ["muted-foreground", "card"],
      ["accent-foreground", "accent"],
      ["destructive", "background"],
      ["destructive", "card"],
    ];
    for (const [text, surface] of pairs) {
      expect(contrast(v[text], v[surface]), `${text} on ${surface}`).toBeGreaterThanOrEqual(
        AAA_TEXT_CONTRAST,
      );
    }
  });

  it.each(AAA_THEME_IDS)("%s keeps its accents and focus ring visible", (theme) => {
    const v = themeVars(theme);
    for (const accent of ["primary", "ring"]) {
      expect(contrast(v[accent], v.background), accent).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
      expect(contrast(v[accent], v.card), `${accent} on card`).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    }
  });

  it("keeps High Contrast free of any colour", () => {
    for (const value of Object.values(themeVars("contrast"))) {
      if (!value.startsWith("#")) continue;
      const [r, g, b] = [1, 3, 5].map((i) => value.slice(i, i + 2));
      expect(r === g && g === b, value).toBe(true);
    }
  });

  it("keeps each style's four editable colours in step with appearance.ts", () => {
    for (const theme of THEME_IDS.filter((id) => id !== "light" && id !== "dark")) {
      const v = themeVars(theme);
      const { palette } = THEMES[theme];
      expect({ background: v.background, foreground: v.foreground, card: v.card, primary: v.primary }).toEqual(
        palette,
      );
    }
  });

  it("gives every dark style the dark: variant", () => {
    const variant = CSS.match(/@custom-variant dark \(([^)]*\))\)/)?.[1] ?? "";
    for (const theme of THEME_IDS.filter((id) => THEMES[id].dark)) {
      expect(variant, theme).toContain(`.${theme} *`);
    }
  });
});

describe("saving the style", () => {
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeEach(() => {
    db = drizzle(new Database(":memory:"), { schema });
    migrate(db, { migrationsFolder: "./drizzle" });
  });

  it("has nothing saved on a fresh database", () => {
    expect(readTheme(db)).toBeNull();
  });

  it.each(["nord", "contrast", "system", "sepia"])("round-trips %s", (theme) => {
    expect(writeTheme(theme, db)).toBe(theme);
    expect(readTheme(db)).toBe(theme);
  });

  it("keeps the latest choice", () => {
    writeTheme("paper", db);
    writeTheme("slate", db);
    expect(readTheme(db)).toBe("slate");
  });

  it("refuses anything that is not a style, keeping what was there", () => {
    writeTheme("solarized", db);
    expect(writeTheme("hotdog", db)).toBeNull();
    expect(writeTheme("</script>", db)).toBeNull();
    expect(writeTheme(42, db)).toBeNull();
    expect(readTheme(db)).toBe("solarized");
  });

  it("ignores a stored value that is no longer a style", () => {
    writeSetting("theme", "retired-style", db);
    expect(readTheme(db)).toBeNull();
    expect(readSetting("theme", db)).toBe("retired-style");
  });
});

describe("themeBootScript", () => {
  /** Runs the script against a stand-in `<html>`, localStorage and matchMedia. */
  function boot(saved: Parameters<typeof themeBootScript>[0], prefersDark = false, stored?: string) {
    const classes = new Set(["h-full", "light"]);
    const attributes: Record<string, string> = {};
    const storage = new Map<string, string>(stored ? [[THEME_STORAGE_KEY, stored]] : []);
    const html = {
      classList: {
        add: (...names: string[]) => names.forEach((n) => classes.add(n)),
        remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
      },
      setAttribute: (name: string, value: string) => (attributes[name] = value),
      style: { colorScheme: "" },
    };
    runInNewContext(themeBootScript(saved), {
      document: { documentElement: html },
      localStorage: { setItem: (k: string, v: string) => storage.set(k, v) },
      matchMedia: () => ({ matches: prefersDark }),
    });
    return { classes, attributes, storage, colorScheme: html.style.colorScheme };
  }

  it("applies a saved style before paint", () => {
    const result = boot("nord");
    expect(result.classes).toEqual(new Set(["h-full", "nord"]));
    expect(result.attributes["data-theme"]).toBe("nord");
    expect(result.colorScheme).toBe("dark");
  });

  it("makes the database win over a stale localStorage value", () => {
    expect(boot("paper", false, "midnight").storage.get(THEME_STORAGE_KEY)).toBe("paper");
  });

  it("resolves system from the computer's setting", () => {
    expect(boot("system", true).classes.has("dark")).toBe(true);
    const light = boot("system", false);
    expect(light.classes.has("light")).toBe(true);
    expect(light.colorScheme).toBe("light");
  });

  it("does nothing when no style has been saved", () => {
    expect(themeBootScript(null)).toBe("");
  });

  it("survives a browser that blocks storage", () => {
    const html = {
      classList: { add() {}, remove() {} },
      setAttribute() {},
      style: { colorScheme: "" },
    };
    expect(() =>
      runInNewContext(themeBootScript("slate"), {
        document: { documentElement: html },
        localStorage: {
          setItem() {
            throw new Error("denied");
          },
        },
        matchMedia: () => ({ matches: false }),
      }),
    ).not.toThrow();
    expect(html.style.colorScheme).toBe("dark");
  });
});
