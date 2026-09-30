"use client";

/** Settings → Flashcards: which way cards show while studying. */
import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FlashcardFormatPreview } from "@/components/study/format-preview";
import { toast } from "@/lib/notify";
import { setFlashcardFormat } from "@/lib/settings-actions";
import {
  DEFAULT_FLASHCARD_FORMAT,
  FLASHCARD_FORMAT_LABELS,
  FLASHCARD_FORMATS,
  type FlashcardFormat,
} from "@/lib/settings-shared";

export function FlashcardFormatSettings({ initial }: { initial: FlashcardFormat }) {
  const [format, setFormat] = useState(initial);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Flashcards</CardTitle>
        <CardDescription>
          How cards show while you study. You can also change this each time
          you start a deck.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor="settings-flashcard-format" className="text-sm font-normal">
            Card style
          </Label>
          <Select
            value={format}
            onValueChange={async (value) => {
              const previous = format;
              setFormat(value as FlashcardFormat);
              const result = await setFlashcardFormat(value);
              if (!result.ok) {
                setFormat(previous);
                toast.error(result.error ?? "Could not save that.");
              }
            }}
          >
            <SelectTrigger id="settings-flashcard-format" className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FLASHCARD_FORMATS.map((option) => (
                <SelectItem key={option} value={option}>
                  {FLASHCARD_FORMAT_LABELS[option].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-muted-foreground text-sm">
          {FLASHCARD_FORMAT_LABELS[format].blurb}
        </p>
        {format !== DEFAULT_FLASHCARD_FORMAT ? (
          <FlashcardFormatPreview key={format} format={format} />
        ) : null}
      </CardContent>
    </Card>
  );
}
