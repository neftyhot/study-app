"use client";

/**
 * Which files, and which pages of each.
 *
 * Shared by generation and the practice exam, so "slides 12 to 30 of the
 * olfactory lecture" is asked the same way whichever one is being set up.
 */
import type { ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FileChoice, SourceOption } from "@/lib/generate/selection";

/** What each format calls a page, so the label matches the student's file. */
export function unitWord(fileType: string, plural = false): string {
  const word =
    fileType === "pptx" ? "slide" : fileType === "pdf" ? "page" : "section";
  return plural ? `${word}s` : word;
}

export function SourceRangePicker({
  sources,
  choices,
  onChange,
  disabled,
  title,
  alwaysCheckable,
  children,
}: {
  sources: SourceOption[];
  choices: Record<string, FileChoice>;
  onChange: (next: Record<string, FileChoice>) => void;
  disabled?: boolean;
  /** Heading above the list; defaults to generation's wording. */
  title?: string;
  /** Show the include box even with one file, when there is something else to pick. */
  alwaysCheckable?: boolean;
  /** Extra controls under an included file, e.g. its topics. */
  children?: (source: SourceOption, choice: FileChoice) => ReactNode;
}) {
  function setChoice(id: string, patch: Partial<FileChoice>) {
    onChange({ ...choices, [id]: { ...choices[id], ...patch } });
  }

  const checkable = alwaysCheckable || sources.length > 1;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {title ?? (sources.length === 1 ? "Slide range" : "Files and ranges")}
      </p>

      {sources.map((source) => {
        const choice = choices[source.id];
        if (!choice) return null;

        return (
          <div key={source.id} className="space-y-2 rounded-md border p-2">
            <div className="flex items-start gap-2">
              {checkable ? (
                <Checkbox
                  id={`include-${source.id}`}
                  checked={choice.included}
                  disabled={disabled}
                  onCheckedChange={(value) =>
                    setChoice(source.id, { included: value === true })
                  }
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <Label
                  htmlFor={`include-${source.id}`}
                  className="block truncate text-sm font-normal"
                >
                  {displayName(source.filename)}
                </Label>
                {source.lastIndex > 0 ? (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {unitWord(source.fileType, true)} {source.firstIndex}–
                    {source.lastIndex}
                    {source.units < source.lastIndex - source.firstIndex + 1
                      ? ` · ${source.units} with readable text`
                      : ""}
                  </p>
                ) : null}
              </div>
            </div>

            {choice.included && source.lastIndex > 0 ? (
              <div className="flex flex-wrap items-center gap-3 pl-0 sm:pl-6">
                <RangeToggle
                  id={source.id}
                  whole={choice.whole}
                  disabled={disabled}
                  label={`All ${unitWord(source.fileType, true)} (${source.firstIndex} to ${source.lastIndex})`}
                  onChange={(whole) =>
                    setChoice(source.id, {
                      whole,
                      from: source.firstIndex,
                      to: source.lastIndex,
                    })
                  }
                />

                {!choice.whole ? (
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`from-${source.id}`}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      From
                    </Label>
                    <Input
                      id={`from-${source.id}`}
                      type="number"
                      inputMode="numeric"
                      min={source.firstIndex}
                      max={source.lastIndex}
                      value={choice.from}
                      disabled={disabled}
                      className="h-8 w-20"
                      onChange={(event) =>
                        setChoice(source.id, {
                          from: clamp(event.target.value, source),
                        })
                      }
                    />
                    <Label
                      htmlFor={`to-${source.id}`}
                      className="text-muted-foreground text-xs font-normal"
                    >
                      to
                    </Label>
                    <Input
                      id={`to-${source.id}`}
                      type="number"
                      inputMode="numeric"
                      min={source.firstIndex}
                      max={source.lastIndex}
                      value={choice.to}
                      disabled={disabled}
                      className="h-8 w-20"
                      onChange={(event) =>
                        setChoice(source.id, {
                          to: clamp(event.target.value, source),
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            {choice.included && children ? (
              <div className="pl-0 sm:pl-6">{children(source, choice)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Upload names arrive URL-encoded; a renamed file may hold a bare "%". */
function displayName(filename: string): string {
  try {
    return decodeURIComponent(filename);
  } catch {
    return filename;
  }
}

function clamp(value: string, source: SourceOption): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return source.firstIndex;
  return Math.min(source.lastIndex, Math.max(source.firstIndex, parsed));
}

function RangeToggle({
  id,
  whole,
  label,
  disabled,
  onChange,
}: {
  id: string;
  whole: boolean;
  label: string;
  disabled?: boolean;
  onChange: (whole: boolean) => void;
}) {
  return (
    <div className="flex gap-1 rounded-md border p-0.5 text-xs">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={whole}
        onClick={() => onChange(true)}
        className={`rounded px-2 py-1 transition-colors disabled:opacity-50 ${
          whole ? "bg-primary text-primary-foreground" : "hover:bg-muted"
        }`}
      >
        {label}
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!whole}
        onClick={() => onChange(false)}
        data-testid={`custom-range-${id}`}
        className={`rounded px-2 py-1 transition-colors disabled:opacity-50 ${
          whole ? "hover:bg-muted" : "bg-primary text-primary-foreground"
        }`}
      >
        Custom range
      </button>
    </div>
  );
}
