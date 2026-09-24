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
    // Bench: 64 cards on a 96-page chapter; real decks land at about half.
    expectedPerUnit: 0.3,
    blurb:
      "Objectives, bolded emphasis and summary tables only. Related sub-points are folded into one synthesis card.",
  },
  standard: {
    label: "Standard",
    cardsPerUnit: 1,
    // Bench: 138 cards on a 96-page chapter; real decks land at about half.
    expectedPerUnit: 0.7,
    blurb:
      "Core definitions, mechanisms and relationships. Conversational and repeated bullets are skipped.",
  },
  exhaustive: {
    label: "Exhaustive",
    cardsPerUnit: 2.5,
    // Bench: 321 cards on a 96-page chapter; real decks land at about half.
    expectedPerUnit: 1.5,
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
    // The bench (one dense 96-page chapter) measured 0.6, 0.95 and 2.1 a
    // page, and the estimate built on it ran about twice what arrived. Real
    // decks (632 units of lecture slides and objectives, exhaustive) produced
    // 1.0 accepted cards a unit, so these are the field numbers, scaled down
    // from the bench in the same proportion.
    expectedPerUnit: { high_yield: 0.3, standard: 0.5, exhaustive: 1 },
  },
};

/**
 * For any model not yet measured: gemini-2.5-flash's overshoot, since that is
 * the model most prompts were tuned against, but yields halved, because every
 * bench figure has come in at about twice what real decks produce.
 */
const FALLBACK_CALIBRATION: ModelCalibration = {
  overshoot: MODEL_CALIBRATION["gemini-2.5-flash"].overshoot,
  expectedPerUnit: {
    high_yield: DENSITY_PRESETS.high_yield.expectedPerUnit,
    standard: DENSITY_PRESETS.standard.expectedPerUnit,
    exhaustive: DENSITY_PRESETS.exhaustive.expectedPerUnit,
  },
};

export function calibrationFor(model?: string | null): ModelCalibration {
  return (model && MODEL_CALIBRATION[model]) || FALLBACK_CALIBRATION;
}

/** The narrowest and widest a custom ratio may be set. */
export const MIN_RATIO = 0.1;
export const MAX_RATIO = 4;

/**
 * The ceiling on an admin licence. Above `MAX_RATIO` a run changes character
 * (see `isHighDensity`): it asks for an exact count, cuts batches small enough
 * for the model to write that many, and lists what is already covered so the
 * extra cards come from new angles instead of rephrasing.
 */
export const ADMIN_MAX_RATIO = 40;

/** A custom ratio only an admin licence can ask for. */
export function isHighDensity(mode: DensityMode, ratio?: number | null): boolean {
  return mode === "custom" && typeof ratio === "number" && ratio > MAX_RATIO;
}

/**
 * Cards one request is asked to write, at most. A lean card is roughly 150
 * output tokens, and 8,192 is the smallest output limit among the providers.
 */
export const MAX_CARDS_PER_BATCH = 40;

/** Pages per request for a ratio, so a high ratio stays within one reply. */
export function batchSizeFor(ratio: number, base: number): number {
  return Math.max(1, Math.min(base, Math.floor(MAX_CARDS_PER_BATCH / ratio)));
}

export function isDensityMode(value: unknown): value is DensityMode {
  return (
    typeof value === "string" &&
    (DENSITY_MODES as readonly string[]).includes(value)
  );
}

/** The cards-per-unit a mode implies, with `custom` supplying its own. */
export function ratioFor(
  mode: DensityMode,
  custom?: number | null,
  /** `ADMIN_MAX_RATIO` for an admin licence; the server decides which. */
  max: number = MAX_RATIO,
): number {
  if (mode === "custom") {
    const ratio = typeof custom === "number" ? custom : DENSITY_PRESETS.standard.cardsPerUnit;
    return Math.min(max, Math.max(MIN_RATIO, ratio));
  }
  return DENSITY_PRESETS[mode].cardsPerUnit;
}

/**
 * What a setting is expected to produce per unit, for the estimate.
 *
 * A custom ratio is what the student asked for, and models deliver a steady
 * fraction of what they are asked: the fraction the standard preset gets
 * (asked 1 a page, flash-lite delivers about 0.5). Taking the request at its
 * word is what made the custom estimate run about double.
 *
 * An admin ratio above `MAX_RATIO` is stated to the model as an exact count
 * rather than scaled by its overshoot, so the delivered fraction above does
 * not apply; runs like that are unmeasured, and dense slides tend to run out
 * of distinct facts first, so the estimate assumes about two-thirds arrive.
 *
 * `measured` is this install's own history for the setting, which corrects
 * the calibration as runs accumulate. It is per preset only: custom runs ask
 * for different ratios, so their history does not describe the next one.
 */
export function expectedFor(
  mode: DensityMode,
  custom?: number | null,
  model?: string | null,
  measured?: MeasuredYield | null,
): number {
  const calibration = model ? calibrationFor(model).expectedPerUnit : null;
  if (isHighDensity(mode, custom)) {
    return ratioFor(mode, custom, ADMIN_MAX_RATIO) * HIGH_DENSITY_DELIVERED;
  }
  if (mode === "custom") {
    const standardYield =
      calibration?.standard ?? DENSITY_PRESETS.standard.expectedPerUnit;
    const delivered = standardYield / DENSITY_PRESETS.standard.cardsPerUnit;
    return blendYield(ratioFor(mode, custom) * delivered, measured);
  }
  return blendYield(
    calibration ? calibration[mode] : DENSITY_PRESETS[mode].expectedPerUnit,
    measured,
  );
}

const HIGH_DENSITY_DELIVERED = 2 / 3;

/** What finished runs on this install actually produced, per setting. */
export type MeasuredYield = { cards: number; units: number };

/** Below this many units, a run says more about the file than the setting. */
export const MIN_MEASURED_UNITS = 20;

/**
 * Pull a calibrated yield toward what this install has really produced.
 *
 * The calibration comes from one bench chapter; the history comes from the
 * student's own decks, so it wins as it grows: at 100 units it carries half
 * the weight, at 600 about six-sevenths.
 */
export function blendYield(
  calibrated: number,
  measured?: MeasuredYield | null,
): number {
  if (!measured || measured.units < MIN_MEASURED_UNITS) return calibrated;
  const weight = measured.units / (measured.units + 100);
  return calibrated * (1 - weight) + (measured.cards / measured.units) * weight;
}

/**
 * A range, not a number.
 *
 * Centred on what arrives rather than skewed high: an estimate that is always
 * above the result reads as a broken promise. Rejected cards never count.
 */
export function estimateCards(
  units: number,
  ratio: number,
): { low: number; high: number } {
  const middle = units * ratio;
  return {
    low: Math.max(units > 0 ? 1 : 0, Math.round(middle * 0.8)),
    high: Math.max(units > 0 ? 1 : 0, Math.round(middle * 1.15)),
  };
}

export function formatEstimate(units: number, ratio: number): string {
  if (units === 0) return "nothing selected";
  const { low, high } = estimateCards(units, ratio);
  return low === high ? `~${low} cards` : `~${low}–${high} cards`;
}
