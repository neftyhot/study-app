/**
 * Extraction density: how finely the material is cut into cards.
 *
 * The ratios are targets, not quotas. Card counts come from what the material
 * actually contains, so this changes what the model is told to keep and what
 * to fold together — not a number it is made to hit. The estimate shown in the
 * UI is derived from the same ratios and labelled as an estimate, because a
 * promise of "110 cards" that arrives as 60 is worse than no number at all.
 *
 * Pure and dependency-free: the panel imports it in the browser and the
 * generation pipeline imports it on the server.
 */

export const DENSITY_MODES = [
  "high_yield",
  "standard",
  "exhaustive",
  "custom",
] as const;

export type DensityMode = (typeof DENSITY_MODES)[number];

export type DensityPreset = {
  label: string;
  /** The density asked for — what the model's target is derived from. */
  cardsPerUnit: number;
  /**
   * What that setting actually produces, measured. Used for the estimate and
   * the label, because a model told "one a page" does not produce one a page:
   * on dense lecture material it lands well above any target it is given.
   */
  expectedPerUnit: number;
  blurb: string;
};

export const DENSITY_PRESETS: Record<
  Exclude<DensityMode, "custom">,
  DensityPreset
> = {
  high_yield: {
    label: "High-yield cram",
    cardsPerUnit: 0.3,
    // Endocrine chapter, 96 pages: 64 cards.
    expectedPerUnit: 0.6,
    blurb:
      "Objectives, bolded emphasis and summary tables only. Related sub-points are folded into one synthesis card.",
  },
  standard: {
    label: "Standard",
    cardsPerUnit: 1,
    // Endocrine chapter, 96 pages: 138 cards.
    expectedPerUnit: 1.4,
    blurb:
      "Core definitions, mechanisms and relationships. Conversational and repeated bullets are skipped.",
  },
  exhaustive: {
    label: "Exhaustive",
    cardsPerUnit: 2.5,
    // Endocrine chapter: 321 cards; whole 314-page deck: 867.
    expectedPerUnit: 3,
    blurb:
      "Every testable detail, every sub-bullet, every step of every pathway. This is what the deck did before this setting existed.",
  },
};

export const DEFAULT_DENSITY: DensityMode = "standard";

type Preset = Exclude<DensityMode, "custom">;

/**
 * How one model responds to being told a density.
 *
 * Models do not follow a stated target the same way. Told "about half a card
 * a page", gemini-2.5-flash produced nearly three times that while
 * gemini-3.1-flash-lite produced almost exactly it. So the number put in the
 * prompt is divided by the model's measured `overshoot`, and the estimate the
 * student sees uses the model's own measured yield rather than one model's
 * numbers applied to another.
 *
 * Every figure here is from `npm run generate:bench` on the same 96-page
 * Endocrine chapter. Re-measure when adding or changing a model.
 */
export type ModelCalibration = {
  overshoot: number;
  /**
   * Pages per request. Smaller models attend to fewer pages at once: on a
   * batch of 18 gemini-3.1-flash-lite covered about half of what it did on a
   * batch of 8, whatever it was told.
   */
  batchSize?: number;
  expectedPerUnit: Record<Preset, number>;
};

export const MODEL_CALIBRATION: Record<string, ModelCalibration> = {
  "gemini-2.5-flash": {
    overshoot: 1.9,
    // 64, 138 and 321 cards.
    expectedPerUnit: { high_yield: 0.6, standard: 1.4, exhaustive: 3 },
  },
  "gemini-3.1-flash-lite": {
    // Told 0.5 a page it produced 0.5, so it follows a stated target almost
    // literally — and undershoots the prose. Asking for twice the density
    // lands on it.
    overshoot: 0.5,
    batchSize: 8,
    // 56, 91 and 200 cards, each in 5-8 seconds.
    expectedPerUnit: { high_yield: 0.6, standard: 0.95, exhaustive: 2.1 },
  },
};

/** The calibration measured first, used for any model not yet measured. */
const FALLBACK_CALIBRATION = MODEL_CALIBRATION["gemini-2.5-flash"];

export function calibrationFor(model?: string | null): ModelCalibration {
  return (model && MODEL_CALIBRATION[model]) || FALLBACK_CALIBRATION;
}

/** The narrowest and widest a custom ratio may be set. */
export const MIN_RATIO = 0.1;
export const MAX_RATIO = 4;

export function isDensityMode(value: unknown): value is DensityMode {
  return (
    typeof value === "string" &&
    (DENSITY_MODES as readonly string[]).includes(value)
  );
}

/** The cards-per-unit a mode implies, with `custom` supplying its own. */
export function ratioFor(mode: DensityMode, custom?: number | null): number {
  if (mode === "custom") {
    const ratio = typeof custom === "number" ? custom : DENSITY_PRESETS.standard.cardsPerUnit;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
  }
  return DENSITY_PRESETS[mode].cardsPerUnit;
}

/**
 * What a setting is expected to produce per unit, for the estimate.
 *
 * A custom ratio is the student's own statement of what they want, so it is
 * taken at its word; the observed average shown beside the estimate is what
 * corrects it after the first run.
 */
export function expectedFor(
  mode: DensityMode,
  custom?: number | null,
  model?: string | null,
): number {
  if (mode === "custom") return ratioFor(mode, custom);
  return model
    ? calibrationFor(model).expectedPerUnit[mode]
    : DENSITY_PRESETS[mode].expectedPerUnit;
}

/**
 * A range, not a number.
 *
 * The spread is deliberately wide and asymmetric: material varies far more
 * than the setting does, and a dense slide produces several cards whatever it
 * is set to.
 */
export function estimateCards(
  units: number,
  ratio: number,
): { low: number; high: number } {
  const middle = units * ratio;
  return {
    low: Math.max(units > 0 ? 1 : 0, Math.round(middle * 0.75)),
    high: Math.round(middle * 1.35),
  };
}

export function formatEstimate(units: number, ratio: number): string {
  if (units === 0) return "nothing selected";
  const { low, high } = estimateCards(units, ratio);
  return low === high ? `~${low} cards` : `~${low}–${high} cards`;
}
