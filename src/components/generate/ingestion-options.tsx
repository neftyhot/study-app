"use client";

/**
 * What to read, and how finely to cut it.
 *
 * Both controls exist because the whole file at full density is often the
 * wrong ask: one chapter is on the exam, or there is a night left and a
 * 300-card deck is not a study plan. The estimate is shown as a range and
 * labelled an estimate — the count comes from what the material contains, and
 * a promised "110 cards" that arrives as 60 is worse than no number at all.
 */
import { useMemo } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DENSITY_PRESETS,
  expectedFor,
  formatEstimate,
  MAX_RATIO,
  MIN_RATIO,
  type DensityMode,
} from "@/lib/generate/density";
import {
  selectedUnits,
  type FileChoice,
  type SourceOption,
} from "@/lib/generate/selection";

export type { FileChoice, SourceOption };

export type OptionsState = {
  density: DensityMode;
  /** Cards per unit, meaningful when the density is "custom". */
  ratio: number;
  choices: Record<string, FileChoice>;
};

/** What each format calls a page, so the label matches the student's file. */
function unitWord(fileType: string, plural = false): string {
  const word =
    fileType === "pptx" ? "slide" : fileType === "pdf" ? "page" : "section";
  return plural ? `${word}s` : word;
}

export function IngestionOptions({
  sources,
  state,
  onChange,
  disabled,
  observedRatio,
}: {
  sources: SourceOption[];
  state: OptionsState;
  onChange: (next: OptionsState) => void;
  disabled?: boolean;
  /** Cards per unit this deck actually produced last time, when it has. */
  observedRatio?: number | null;
}) {
  // What the setting produces, not what it asks for — see `expectedPerUnit`.
  const ratio = expectedFor(state.density, state.ratio);
  const units = useMemo(
    () => selectedUnits(sources, state.choices),
    [sources, state.choices],
  );

  function setChoice(id: string, patch: Partial<FileChoice>) {
    onChange({
      ...state,
      choices: {
        ...state.choices,
        [id]: { ...state.choices[id], ...patch },
      },
    });
  }

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-2">
        <p className="text-sm font-medium">Extraction density</p>
        <div className="grid gap-2 sm:grid-cols-4">
          {(
            ["high_yield", "standard", "exhaustive"] as const
          ).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={disabled}
              aria-pressed={state.density === mode}
              onClick={() => onChange({ ...state, density: mode })}
              className={`rounded-md border p-2 text-left text-sm transition-colors disabled:opacity-50 ${
                state.density === mode
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/60"
              }`}
            >
              <span className="block font-medium">
                {DENSITY_PRESETS[mode].label}
              </span>
              <span className="text-muted-foreground block text-xs tabular-nums">
                ~{DENSITY_PRESETS[mode].expectedPerUnit} per{" "}
                {unitWord(sources[0]?.fileType ?? "pdf")}
              </span>
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            aria-pressed={state.density === "custom"}
            onClick={() => onChange({ ...state, density: "custom" })}
            className={`rounded-md border p-2 text-left text-sm transition-colors disabled:opacity-50 ${
              state.density === "custom"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/60"
            }`}
          >
            <span className="block font-medium">Custom</span>
            <span className="text-muted-foreground block text-xs tabular-nums">
              {state.ratio.toFixed(1)} per {unitWord(sources[0]?.fileType ?? "pdf")}
            </span>
          </button>
        </div>

        {state.density === "custom" ? (
          <div className="flex items-center gap-3 pt-1">
            <Slider
              value={[state.ratio]}
              min={MIN_RATIO}
              max={MAX_RATIO}
              step={0.1}
              disabled={disabled}
              onValueChange={([value]) => onChange({ ...state, ratio: value })}
              className="max-w-xs"
              aria-label="Cards per slide"
            />
            <span className="text-muted-foreground w-28 text-xs tabular-nums">
              {state.ratio.toFixed(1)} cards / {unitWord(sources[0]?.fileType ?? "pdf")}
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {DENSITY_PRESETS[state.density].blurb}
          </p>
        )}
      </div>

      {sources.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {sources.length === 1 ? "Slide range" : "Files and ranges"}
          </p>

          {sources.map((source) => {
            const choice = state.choices[source.id];
            if (!choice) return null;

            return (
              <div key={source.id} className="space-y-2 rounded-md border p-2">
                <div className="flex items-start gap-2">
                  {sources.length > 1 ? (
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
                      {decodeURIComponent(source.filename)}
                    </Label>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {unitWord(source.fileType, true)} {source.firstIndex}–
                      {source.lastIndex}
                      {source.units < source.lastIndex - source.firstIndex + 1
                        ? ` · ${source.units} with readable text`
                        : ""}
                    </p>
                  </div>
                </div>

                {choice.included ? (
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
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-3">
        <p className="text-sm">
          <strong className="tabular-nums">{formatEstimate(units, ratio)}</strong>{" "}
          <span className="text-muted-foreground">
            estimated from {units}{" "}
            {unitWord(sources[0]?.fileType ?? "pdf", units !== 1)}
          </span>
        </p>
        {observedRatio ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            This deck has averaged {observedRatio.toFixed(1)} cards per{" "}
            {unitWord(sources[0]?.fileType ?? "pdf")} so far.
          </p>
        ) : null}
      </div>
    </div>
  );
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
