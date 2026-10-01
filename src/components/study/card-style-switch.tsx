"use client";

/**
 * The three card styles side by side, one press to change. Whatever is
 * picked here becomes the default, as choosing it in settings would.
 */
import { useState } from "react";
import { FlipHorizontal2, Layers, PanelTop, type LucideIcon } from "lucide-react";

import { setFlashcardFormat } from "@/lib/settings-actions";
import {
  FLASHCARD_FORMATS,
  FLASHCARD_FORMAT_LABELS,
  type FlashcardFormat,
} from "@/lib/settings-shared";
import { cn } from "@/lib/utils";

const ICONS: Record<FlashcardFormat, LucideIcon> = {
  classic: PanelTop,
  flip: FlipHorizontal2,
  stack: Layers,
};

export function CardStyleSwitch({
  value,
  onChange,
  className,
}: {
  value: FlashcardFormat;
  onChange?: (format: FlashcardFormat) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Card style"
      className={cn(
        "bg-muted inline-flex items-center gap-0.5 rounded-lg p-0.5",
        className,
      )}
    >
      {FLASHCARD_FORMATS.map((option) => {
        const Icon = ICONS[option];
        const selected = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            title={FLASHCARD_FORMAT_LABELS[option].blurb}
            onClick={() => {
              if (selected) return;
              onChange?.(option);
              void setFlashcardFormat(option);
            }}
            className={cn(
              "focus-visible:ring-ring inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {FLASHCARD_FORMAT_LABELS[option].label}
          </button>
        );
      })}
    </div>
  );
}

/** The switch on its own, for pages that only set the default. */
export function CardStyleDefault({ initial }: { initial: FlashcardFormat }) {
  const [value, setValue] = useState(initial);
  return <CardStyleSwitch value={value} onChange={setValue} />;
}
