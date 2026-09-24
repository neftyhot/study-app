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
import { useMemo, useSyncExternalStore } from "react";

import {
  SourceRangePicker,
  unitWord,
} from "@/components/generate/source-range-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  ADMIN_MAX_RATIO,
  DENSITY_PRESETS,
  expectedFor,
  formatEstimate,
  isHighDensity,
  MAX_RATIO,
  MIN_RATIO,
  type DensityMode,
  type MeasuredYield,
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

/** Remembered per computer, like the theme: it is a way of working. */
const NUMBER_INPUTS_KEY = "study-app:admin-number-inputs";

const numberInputListeners = new Set<() => void>();

function readNumberInputs(): boolean {
  try {
    return localStorage.getItem(NUMBER_INPUTS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeNumberInputs(on: boolean) {
  try {
    localStorage.setItem(NUMBER_INPUTS_KEY, on ? "1" : "0");
  } catch {
    // Not remembered; the change still applies to this page.
  }
  numberInputListeners.forEach((listener) => listener());
}

function subscribeNumberInputs(listener: () => void) {
  numberInputListeners.add(listener);
  return () => {
    numberInputListeners.delete(listener);
  };
}

export function IngestionOptions({
  sources,
  state,
  onChange,
  disabled,
  observedRatio,
  model,
  measured,
  isAdmin = false,
}: {
  sources: SourceOption[];
  state: OptionsState;
  onChange: (next: OptionsState) => void;
  disabled?: boolean;
  /** Cards per unit this deck actually produced last time, when it has. */
  observedRatio?: number | null;
  /** The model a run will use, whose measured yields the estimate follows. */
  model?: string | null;
  /** What finished runs on this install produced, per setting. */
  measured?: Partial<Record<DensityMode, MeasuredYield>>;
  /**
   * An admin licence may type an exact count, up to `ADMIN_MAX_RATIO`. The
   * server enforces the ceiling; this only decides which control is shown.
   */
  isAdmin?: boolean;
}) {
  const numberInputs = useSyncExternalStore(
    subscribeNumberInputs,
    readNumberInputs,
    () => false,
  );
  const typed = isAdmin && numberInputs;

  function toggleNumberInputs(on: boolean) {
    writeNumberInputs(on);
    // A typed number is a custom ratio. Turning it off leaves an admin-only
    // ratio behind, which the slider cannot show, so bring it back in range.
    if (on && state.density !== "custom") {
      onChange({
        ...state,
        density: "custom",
        ratio: DENSITY_PRESETS[state.density].cardsPerUnit,
      });
    } else if (!on && state.ratio > MAX_RATIO) {
      onChange({ ...state, ratio: MAX_RATIO });
    }
  }

  // What the setting produces, not what it asks for — see `expectedPerUnit`.
  const ratio = expectedFor(
    state.density,
    state.ratio,
    model,
    measured?.[state.density],
  );
  const unit = unitWord(sources[0]?.fileType ?? "pdf");
  const units = useMemo(
    () => selectedUnits(sources, state.choices),
    [sources, state.choices],
  );

  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Extraction density</p>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id="admin-number-inputs"
                checked={numberInputs}
                disabled={disabled}
                onCheckedChange={(checked) => toggleNumberInputs(checked === true)}
              />
              <Label htmlFor="admin-number-inputs" className="text-xs font-normal">
                Use number inputs (admin)
              </Label>
            </div>
          ) : null}
        </div>
        {typed ? (
          <div className="space-y-1 pt-1">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                min={MIN_RATIO}
                max={ADMIN_MAX_RATIO}
                step={0.1}
                disabled={disabled}
                defaultValue={state.ratio}
                key={state.density === "custom" ? "custom" : "preset"}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (!Number.isFinite(value)) return;
                  onChange({
                    ...state,
                    density: "custom",
                    ratio: Math.min(ADMIN_MAX_RATIO, Math.max(MIN_RATIO, value)),
                  });
                }}
                className="w-28 tabular-nums"
                aria-label={`Cards per ${unit}`}
              />
              <span className="text-muted-foreground text-xs">
                cards per {unit} (up to {ADMIN_MAX_RATIO})
              </span>
            </div>
            <p className="text-muted-foreground text-xs">
              {isHighDensity("custom", state.ratio)
                ? `Above ${MAX_RATIO} per ${unit} the model is asked for exactly this many, a few ${unit}s at a time, and told which questions already exist so it takes new angles instead of repeating. Near-duplicates are rejected. Dense material can run out of distinct facts first, so expect fewer.`
                : "The model is asked for about this many; the estimate below is what it usually delivers."}
            </p>
          </div>
        ) : (
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
                  ~{expectedFor(mode, null, model, measured?.[mode]).toFixed(1)} per{" "}
                  {unit}
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
                {Math.min(state.ratio, MAX_RATIO).toFixed(1)} per {unit}
              </span>
            </button>
          </div>
        )}

        {typed ? null : state.density === "custom" ? (
          <div className="flex items-center gap-3 pt-1">
            <Slider
              value={[Math.min(state.ratio, MAX_RATIO)]}
              min={MIN_RATIO}
              max={MAX_RATIO}
              step={0.1}
              disabled={disabled}
              onValueChange={([value]) => onChange({ ...state, ratio: value })}
              className="max-w-xs"
              aria-label="Cards per slide"
            />
            <span className="text-muted-foreground w-28 text-xs tabular-nums">
              {Math.min(state.ratio, MAX_RATIO).toFixed(1)} cards / {unit}
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
