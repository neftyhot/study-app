import { describe, expect, it } from "vitest";

import {
  appearanceCss,
  contrast,
  DEFAULT_APPEARANCE,
  ensureContrast,
  MIN_ACCENT_CONTRAST,
  MIN_TEXT_CONTRAST,
  resolvePalette,
  sanitizeAppearance,
  THEME_IDS,
  THEMES,
} from "./appearance";

describe("contrast", () => {
  it("matches the WCAG extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#777777", "#777777")).toBe(1);
  });
});

describe("the built-in styles", () => {
  it.each(THEME_IDS)("%s is readable as shipped", (theme) => {
    const { background, foreground, card, primary } = THEMES[theme].palette;
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(foreground, card)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(primary, background)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
    expect(resolvePalette(theme).adjusted).toEqual({});
  });
});

describe("keeping text readable", () => {
  it("moves text that is too close to its background", () => {
    const palette = resolvePalette("light", { foreground: "#f0f0f0" });
    expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(palette.adjusted.foreground).toBe("#f0f0f0");
  });

  it("keeps the chosen hue rather than jumping to black", () => {
    // A mid blue on white fails; it should come back a darker blue.
    const fixed = ensureContrast("#6f8cff", ["#ffffff"]);
    expect(contrast(fixed, "#ffffff")).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(fixed).not.toBe("#000000");
    const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(fixed.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
  });

  it("re-checks text when only the background changes", () => {
    // Dark text, then a dark background chosen underneath it.
    const palette = resolvePalette("light", { background: "#111111" });
    expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(palette.foreground, palette.card)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("moves a card colour no text could read on alongside the page", () => {
    const palette = resolvePalette("dark", { background: "#000000", card: "#999999", foreground: "#ffffff" });
    expect(contrast(palette.foreground, palette.background)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrast(palette.foreground, palette.card)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(palette.adjusted.card).toBe("#999999");
  });

  it("holds the accent to the lower bar for controls", () => {
    const palette = resolvePalette("bubble", { primary: "#f6f7fb" });
    expect(contrast(palette.primary, palette.background)).toBeGreaterThanOrEqual(MIN_ACCENT_CONTRAST);
  });

  it("fuzzes: no chosen colours ever produce unreadable text", () => {
    const random = (seed: number) => `#${((seed * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(0, 6)}`;
    for (let i = 1; i < 400; i += 1) {
      const theme = THEME_IDS[i % THEME_IDS.length];
      const palette = resolvePalette(theme, {
        background: random(i),
        foreground: random(i * 7 + 3),
        card: i % 3 === 0 ? random(i * 13 + 1) : undefined,
      });
      const worst = Math.min(
        contrast(palette.foreground, palette.background),
        contrast(palette.foreground, palette.card),
      );
      expect(worst).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    }
  });
});

describe("sanitizeAppearance", () => {
  it("drops anything malformed", () => {
    const clean = sanitizeAppearance({
      colors: { light: { background: "red", foreground: "#123456" }, nope: { background: "#000000" } },
      radius: 99,
      textScale: "big",
      font: "comic",
      width: "huge",
    });
    expect(clean.colors).toEqual({ light: { foreground: "#123456" } });
    expect(clean.radius).toBe(1.5);
    expect(clean.textScale).toBe(1);
    expect(clean.font).toBe("style");
    expect(clean.width).toBe("normal");
  });

  it("returns the defaults for nothing at all", () => {
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("appearanceCss", () => {
  it("emits overrides only for the styles that were changed", () => {
    const css = appearanceCss({
      ...DEFAULT_APPEARANCE,
      colors: { bubble: { background: "#fff0f5" } },
      radius: 0.25,
    });
    expect(css).toContain(":root:root.bubble{");
    expect(css).not.toContain(":root:root.dark{");
    expect(css).toContain("--radius:0.25rem;");
  });
});
