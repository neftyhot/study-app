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

import {
  SourceRangePicker,
  unitWord,
} from "@/components/generate/source-range-picker";
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

export function IngestionOptions({
  sources,
  state,
  onChange,
  disabled,
  observedRatio,
  model,
}: {
  sources: SourceOption[];
  state: OptionsState;
  onChange: (next: OptionsState) => void;
  disabled?: boolean;
  /** Cards per unit this deck actually produced last time, when it has. */
  observedRatio?: number | null;
  /** The model a run will use, whose measured yields the estimate follows. */
  model?: string | null;
}) {
  // What the setting produces, not what it asks for — see `expectedPerUnit`.
  const ratio = expectedFor(state.density, state.ratio, model);
  const units = useMemo(
    () => selectedUnits(sources, state.choices),
    [sources, state.choices],
  );

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
                ~{expectedFor(mode, null, model)} per{" "}
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
        <SourceRangePicker
          sources={sources}
          choices={state.choices}
          disabled={disabled}
          onChange={(choices) => onChange({ ...state, choices })}
        />
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
