/**
 * How the app looks: which style, and what the student has changed about it.
 *
 * Shared by the server, which writes the student's choices into the page as
 * CSS before anything paints, and the settings screen, which previews them
 * live. No imports that could not run in both.
 *
 * The one rule this file exists to hold: whatever colours are chosen, text
 * stays readable. A text colour too close to its background is not saved as
 * chosen — it is moved, the least distance it takes, until it reads.
 */

/* ------------------------------------------------------------------ Styles */

export const THEME_IDS = [
  "light",
  "dark",
  "bubble",
  "midnight",
  "sepia",
  "mint",
  "sage",
  "forest",
] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export type Palette = {
  background: string;
  foreground: string;
  card: string;
  primary: string;
};

export type ThemeDefinition = {
  id: ThemeId;
  label: string;
  blurb: string;
  dark: boolean;
  /** Default corner radius, in rem. */
  radius: number;
  font: FontId;
  cardStyle: Exclude<CardStyle, "style">;
  palette: Palette;
};

/**
 * The palettes the colour pickers start from.
 *
 * Kept in step with the matching blocks in `globals.css`, which carry the
 * rest of each style's variables; these four are the ones a student can
 * change, and the ones the readability check is measured against.
 */
export const THEMES: Record<ThemeId, ThemeDefinition> = {
  light: {
    id: "light",
    label: "Light",
    blurb: "Plain and bright.",
    dark: false,
    radius: 0.625,
    font: "sans",
    cardStyle: "outline",
    palette: { background: "#ffffff", foreground: "#0a0a0a", card: "#ffffff", primary: "#171717" },
  },
  dark: {
    id: "dark",
    label: "Dark",
    blurb: "Easy on the eyes at night.",
    dark: true,
    radius: 0.625,
    font: "sans",
    cardStyle: "outline",
    palette: { background: "#0a0a0a", foreground: "#fafafa", card: "#171717", primary: "#e5e5e5" },
  },
  bubble: {
    id: "bubble",
    label: "Bubble",
    blurb: "Soft, rounded and blue — like Quizlet.",
    dark: false,
    radius: 1,
    font: "rounded",
    cardStyle: "shadow",
    palette: { background: "#f6f7fb", foreground: "#282e3e", card: "#ffffff", primary: "#4255ff" },
  },
  midnight: {
    id: "midnight",
    label: "Midnight",
    blurb: "Bubble's night mode: deep navy.",
    dark: true,
    radius: 1,
    font: "rounded",
    cardStyle: "shadow",
    palette: { background: "#0a092d", foreground: "#f6f7fb", card: "#2e3856", primary: "#6a78ff" },
  },
  sepia: {
    id: "sepia",
    label: "Sepia",
    blurb: "Warm paper, for long reading.",
    dark: false,
    radius: 0.5,
    font: "serif",
    cardStyle: "outline",
    palette: { background: "#f4ecd8", foreground: "#3b2f1e", card: "#fbf6ea", primary: "#8a5a2b" },
  },
  mint: {
    id: "mint",
    label: "Mint",
    blurb: "Fresh and green, with soft rounded cards.",
    dark: false,
    radius: 1,
    font: "rounded",
    cardStyle: "shadow",
    palette: { background: "#effaf4", foreground: "#12352a", card: "#ffffff", primary: "#0d8a5c" },
  },
  sage: {
    id: "sage",
    label: "Sage",
    blurb: "Muted herb green, calm for long sessions.",
    dark: false,
    radius: 0.75,
    font: "sans",
    cardStyle: "outline",
    palette: { background: "#eef1e8", foreground: "#26352a", card: "#f8faf4", primary: "#4f6e44" },
  },
  forest: {
    id: "forest",
    label: "Forest",
    blurb: "Deep evergreen for studying at night.",
    dark: true,
    radius: 1,
    font: "rounded",
    cardStyle: "shadow",
    palette: { background: "#0b1f16", foreground: "#e9f6ee", card: "#173528", primary: "#4fd18b" },
  },
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- Settings */

export const FONT_IDS = ["style", "sans", "rounded", "serif", "mono", "system"] as const;
export type FontId = (typeof FONT_IDS)[number];

export const FONT_LABELS: Record<FontId, string> = {
  style: "Style default",
  sans: "Geist",
  rounded: "Rounded (Nunito)",
  serif: "Serif",
  mono: "Monospace",
  system: "System",
};

const FONT_STACKS: Record<Exclude<FontId, "style">, string> = {
  sans: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  rounded: "var(--font-nunito), ui-rounded, ui-sans-serif, system-ui, sans-serif",
  serif: 'ui-serif, Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
  mono: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
};

export const CARD_STYLES = ["style", "outline", "shadow", "flat"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

export const CARD_STYLE_LABELS: Record<CardStyle, string> = {
  style: "Style default",
  outline: "Outlined",
  shadow: "Raised",
  flat: "Flat",
};

export const WIDTHS = { narrow: 56, normal: 72, wide: 90 } as const;
export type Width = keyof typeof WIDTHS;

export type ColorOverrides = Partial<Palette>;

export type Appearance = {
  /** Colour changes, per style — each style keeps its own. */
  colors: Partial<Record<ThemeId, ColorOverrides>>;
  /** Corner radius in rem; null follows the style. */
  radius: number | null;
  /** Multiplies every size in the app. */
  textScale: number;
  font: FontId;
  cardStyle: CardStyle;
  width: Width;
};

export const DEFAULT_APPEARANCE: Appearance = {
  colors: {},
  radius: null,
  textScale: 1,
  font: "style",
  cardStyle: "style",
  width: "normal",
};

export const RADIUS_RANGE = { min: 0, max: 1.5, step: 0.125 } as const;
export const TEXT_SCALE_RANGE = { min: 0.85, max: 1.3, step: 0.05 } as const;

/** WCAG AA for body text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** WCAG AA for large text and UI parts — what the accent colour is held to. */
export const MIN_ACCENT_CONTRAST = 3;

/* ------------------------------------------------------------ Colour maths */

type Rgb = [number, number, number];

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function toRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `a` moved `amount` of the way towards `b`. */
export function mix(a: string, b: string, amount: number): string {
  const [x, y] = [toRgb(a), toRgb(b)];
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * amount) as Rgb);
}

/**
 * `color`, or the nearest colour to it that reaches `ratio` against every one
 * of `against`.
 *
 * It slides towards black or white — whichever direction gets there — by the
 * smallest step that works, so a chosen dark blue comes back a darker blue,
 * not black.
 */
export function ensureContrast(
  color: string,
  against: string[],
  ratio: number = MIN_TEXT_CONTRAST,
): string {
  const passes = (candidate: string) =>
    against.every((background) => contrast(candidate, background) >= ratio);
  if (passes(color)) return color;

  let best: string | null = null;
  let bestStep = Infinity;

  for (const target of ["#000000", "#ffffff"]) {
    for (let step = 1; step <= 100; step += 1) {
      const candidate = mix(color, target, step / 100);
      if (passes(candidate)) {
        if (step < bestStep) {
          best = candidate;
          bestStep = step;
        }
        break;
      }
    }
  }

  // Two backgrounds so far apart that nothing reads on both: pick whichever
  // extreme reads best on the worst of them.
  if (best) return best;
  const worst = (candidate: string) =>
    Math.min(...against.map((background) => contrast(candidate, background)));
  return worst("#000000") >= worst("#ffffff") ? "#000000" : "#ffffff";
}

/* ---------------------------------------------------------- Resolving it */

export type ResolvedPalette = Palette & {
  /** Where the readability rule had to move a colour, and from what. */
  adjusted: Partial<Record<keyof Palette, string>>;
};

/**
 * A style's colours with the student's changes applied, made readable.
 *
 * Background is taken as given — it is the one thing everything else is
 * measured against. The card follows the background unless it was chosen
 * too; text must read on both; the accent must stand out from both.
 */
export function resolvePalette(theme: ThemeId, overrides: ColorOverrides = {}): ResolvedPalette {
  const base = THEMES[theme].palette;
  const adjusted: ResolvedPalette["adjusted"] = {};

  const background = isHex(overrides.background) ? overrides.background : base.background;

  let card: string;
  if (isHex(overrides.card)) card = overrides.card;
  else if (!isHex(overrides.background)) card = base.card;
  else {
    // A changed background with the style's card would clash; follow it,
    // lifted a little the way each style lifts its cards.
    const lift = base.card.toLowerCase() === base.background.toLowerCase() ? 0 : THEMES[theme].dark ? 0.08 : 0.6;
    card = mix(background, "#ffffff", lift);
  }

  const wantedText = isHex(overrides.foreground) ? overrides.foreground : base.foreground;
  let foreground = ensureContrast(wantedText, [background, card]);
  const readsOnCard = contrast(foreground, card) >= MIN_TEXT_CONTRAST;
  if (!readsOnCard || contrast(foreground, background) < MIN_TEXT_CONTRAST) {
    // A card chosen so far from the background that no text reads on both.
    // Text on the page wins; the card is moved until it reads on the card too.
    foreground = ensureContrast(wantedText, [background]);
    const wantedCard = card;
    card = ensureContrast(card, [foreground]);
    if (card !== wantedCard) adjusted.card = wantedCard;
  }
  if (foreground !== wantedText) adjusted.foreground = wantedText;

  const wantedPrimary = isHex(overrides.primary) ? overrides.primary : base.primary;
  const primary = ensureContrast(wantedPrimary, [background, card], MIN_ACCENT_CONTRAST);
  if (primary !== wantedPrimary) adjusted.primary = wantedPrimary;

  return { background, foreground, card, primary, adjusted };
}

/** Whatever was stored, as a valid appearance — unknown or bad values dropped. */
export function sanitizeAppearance(raw: unknown): Appearance {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colors: Appearance["colors"] = {};

  if (input.colors && typeof input.colors === "object") {
    for (const [theme, value] of Object.entries(input.colors as Record<string, unknown>)) {
      if (!isThemeId(theme) || !value || typeof value !== "object") continue;
      const picked: ColorOverrides = {};
      for (const key of ["background", "foreground", "card", "primary"] as const) {
        const color = (value as Record<string, unknown>)[key];
        if (isHex(color)) picked[key] = color.toLowerCase();
      }
      if (Object.keys(picked).length > 0) colors[theme] = picked;
    }
  }

  const number = (value: unknown, min: number, max: number, fallback: number) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.min(max, Math.max(min, value))
      : fallback;

  return {
    colors,
    radius:
      input.radius === null || input.radius === undefined
        ? null
        : number(input.radius, RADIUS_RANGE.min, RADIUS_RANGE.max, 0.625),
    textScale: number(input.textScale, TEXT_SCALE_RANGE.min, TEXT_SCALE_RANGE.max, 1),
    font: (FONT_IDS as readonly unknown[]).includes(input.font) ? (input.font as FontId) : "style",
    cardStyle: (CARD_STYLES as readonly unknown[]).includes(input.cardStyle)
      ? (input.cardStyle as CardStyle)
      : "style",
    width: typeof input.width === "string" && input.width in WIDTHS ? (input.width as Width) : "normal",
  };
}

/* -------------------------------------------------------------------- CSS */

/**
 * Every variable a style defines, derived from its four colours.
 *
 * Only emitted for a style the student has changed; an untouched style is
 * exactly what `globals.css` says.
 */
function paletteVariables(theme: ThemeId, palette: ResolvedPalette): string {
  const { background, foreground, card, primary } = palette;
  const dark = THEMES[theme].dark;

  const onPrimary =
    contrast("#ffffff", primary) >= contrast("#0a0a0a", primary) ? "#ffffff" : "#0a0a0a";
  const subtle = mix(background, foreground, dark ? 0.1 : 0.05);
  const border = mix(background, foreground, dark ? 0.18 : 0.13);
  // Secondary text: as faded as it can be while still passing.
  let muted = mix(foreground, background, 0.4);
  for (let fade = 0.4; fade > 0; fade -= 0.05) {
    muted = mix(foreground, background, fade);
    if (contrast(muted, background) >= MIN_TEXT_CONTRAST && contrast(muted, card) >= MIN_TEXT_CONTRAST) break;
  }

  const vars: Record<string, string> = {
    background,
    foreground,
    card,
    "card-foreground": foreground,
    popover: card,
    "popover-foreground": foreground,
    primary,
    "primary-foreground": onPrimary,
    secondary: subtle,
    "secondary-foreground": foreground,
    muted: subtle,
    "muted-foreground": muted,
    accent: subtle,
    "accent-foreground": foreground,
    border,
    input: border,
    ring: primary,
  };

  return Object.entries(vars)
    .map(([name, value]) => `--${name}:${value};`)
    .join("");
}

/** Replaces the card's ring outright; the style defaults live in globals.css. */
const CARD_SHADOWS: Record<Exclude<CardStyle, "style">, string> = {
  outline: "0 0 0 1px color-mix(in oklab, var(--foreground) 10%, transparent)",
  shadow:
    "0 1px 2px color-mix(in oklab, var(--foreground) 6%, transparent), 0 6px 20px color-mix(in oklab, var(--foreground) 9%, transparent)",
  flat: "none",
};

/**
 * The student's appearance as a stylesheet.
 *
 * Selectors are doubled up (`:root:root`) so they outrank the style blocks in
 * `globals.css` whichever order the two end up in the page.
 */
export function appearanceCss(appearance: Appearance): string {
  const rules: string[] = [];
  const root: string[] = [`--content-width:${WIDTHS[appearance.width]}rem;`];

  if (appearance.radius !== null) root.push(`--radius:${appearance.radius}rem;`);
  if (appearance.font !== "style") root.push(`--font-sans:${FONT_STACKS[appearance.font]};`);
  rules.push(`:root:root[class]{${root.join("")}}`);

  if (appearance.textScale !== 1) {
    rules.push(`html{font-size:${Math.round(appearance.textScale * 1000) / 10}%;}`);
  }

  if (appearance.cardStyle !== "style") {
    rules.push(`:root:root[class] [data-slot="card"]{box-shadow:${CARD_SHADOWS[appearance.cardStyle]};}`);
  }

  for (const theme of THEME_IDS) {
    const overrides = appearance.colors[theme];
    if (!overrides || Object.keys(overrides).length === 0) continue;
    rules.push(`:root:root.${theme}{${paletteVariables(theme, resolvePalette(theme, overrides))}}`);
  }

  return rules.join("\n");
}
