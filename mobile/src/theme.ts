/**
 * The student's style and appearance, stored in the same settings rows as the
 * desktop ("theme", "appearance") and applied the same way: a class on
 * <html>, `data-theme`, the colour scheme, and the appearance stylesheet.
 */
import {
  appearanceCss,
  isThemePreference,
  migrateThemeId,
  sanitizeAppearance,
  THEME_IDS,
  THEMES,
  type Appearance,
  type ThemePreference,
} from "@megan/core/appearance";
import type { SqlDriver } from "@megan/core/platform/types";

import { readSetting, writeSetting } from "./data/settings";

const THEME_KEY = "theme";
const APPEARANCE_KEY = "appearance";

export async function readTheme(db: SqlDriver): Promise<ThemePreference> {
  const value = migrateThemeId(await readSetting(db, THEME_KEY));
  return isThemePreference(value) ? value : "system";
}

export async function writeTheme(db: SqlDriver, theme: ThemePreference): Promise<void> {
  if (isThemePreference(theme)) await writeSetting(db, THEME_KEY, theme);
}

export async function readAppearance(db: SqlDriver): Promise<Appearance> {
  const raw = await readSetting(db, APPEARANCE_KEY);
  try {
    return sanitizeAppearance(raw ? JSON.parse(raw) : null);
  } catch {
    return sanitizeAppearance(null);
  }
}

export async function writeAppearance(db: SqlDriver, appearance: Appearance): Promise<Appearance> {
  const clean = sanitizeAppearance(appearance);
  await writeSetting(db, APPEARANCE_KEY, JSON.stringify(clean));
  return clean;
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function applyTheme(theme: ThemePreference, appearance: Appearance): void {
  const resolved = theme === "system" ? (systemDark() ? "dark" : "light") : theme;
  const html = document.documentElement;
  html.classList.remove(...THEME_IDS);
  html.classList.add(resolved);
  html.setAttribute("data-theme", resolved);
  html.style.colorScheme = THEMES[resolved].dark ? "dark" : "light";

  let sheet = document.getElementById("appearance");
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = "appearance";
    document.head.appendChild(sheet);
  }
  sheet.textContent = appearanceCss(appearance);
}

/** Re-applies "follow my phone" when iOS switches between light and dark. */
export function followSystem(get: () => { theme: ThemePreference; appearance: Appearance }): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = () => {
    const { theme, appearance } = get();
    if (theme === "system") applyTheme(theme, appearance);
  };
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
