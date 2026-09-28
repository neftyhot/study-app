"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { isThemePreference, migrateThemeId, type ThemePreference } from "@/lib/appearance";
import { saveThemeAction } from "@/lib/settings-actions";

/**
 * Copies every style change — from Settings, the header menu, anywhere that
 * calls `setTheme` — into the database, so it survives the desktop app
 * starting on a different port (and so a different localStorage).
 *
 * `saved` is what the server read at render time; only a real change writes.
 */
export function ThemePersistence({ saved }: { saved: ThemePreference | null }) {
  const { theme, setTheme } = useTheme();
  const last = useRef(saved);

  useEffect(() => {
    // A style merged away since it was picked (kept only in localStorage).
    const moved = migrateThemeId(theme);
    if (moved !== theme && isThemePreference(moved)) {
      setTheme(moved);
      return;
    }
    if (!isThemePreference(theme) || theme === last.current) return;
    last.current = theme;
    void saveThemeAction(theme).catch(() => {
      // Still applied for this session; the next change tries again.
      last.current = null;
    });
  }, [theme, setTheme]);

  return null;
}
