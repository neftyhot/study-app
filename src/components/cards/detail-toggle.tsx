"use client";

/**
 * Simple or detailed card writing.
 *
 * Most hand-written cards are a front and a back, and every extra field on
 * screen is one more thing to tab past. Simple hides the rest — images, type,
 * topic, importance, explanation, rubric — until a card actually needs them.
 * The choice is remembered, since someone who wants the detail wants it every
 * time.
 */
import { useEffect, useState } from "react";

export type DetailMode = "simple" | "detailed";

const STORAGE_KEY = "study-app:card-detail";

export function useDetailMode(): [DetailMode, (mode: DetailMode) => void] {
  const [mode, setMode] = useState<DetailMode>("simple");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      // Read after mount, so the server render and the first client render agree.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved === "simple" || saved === "detailed") setMode(saved);
    } catch {
      // Storage can be unavailable; simple is a fine default.
    }
  }, []);

  function update(next: DetailMode) {
    setMode(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }

  return [mode, update];
}

export function DetailToggle({
  value,
  onChange,
}: {
  value: DetailMode;
  onChange: (mode: DetailMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Card fields"
      className="bg-muted inline-flex gap-0.5 rounded-lg p-0.5 text-xs"
    >
      {(
        [
          ["simple", "Simple"],
          ["detailed", "Detailed"],
        ] as const
      ).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          onClick={() => onChange(mode)}
          className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
            value === mode
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
