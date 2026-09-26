"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import { isThemePreference, type ThemePreference } from "@/lib/appearance";
import { saveThemeAction } from "@/lib/settings-actions";

/**
 * Copies every style change — from Settings, the header menu, anywhere that
 * calls `setTheme` — into the database, so it survives the desktop app
 * starting on a different port (and so a different localStorage).
 *
 * `saved` is what the server read at render time; only a real change writes.
 */
export function ThemePersistence({ saved }: { saved: ThemePreference | null }) {
  const { theme } = useTheme();
  const last = useRef(saved);

  useEffect(() => {
    if (!isThemePreference(theme) || theme === last.current) return;
    last.current = theme;
    void saveThemeAction(theme).catch(() => {
      // Still applied for this session; the next change tries again.
      last.current = null;
    });
  }, [theme]);

  return null;
}
