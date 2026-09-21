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
  /** Rough cards per source unit, used for the estimate only. */
  cardsPerUnit: number;
  blurb: string;
};

export const DENSITY_PRESETS: Record<
  Exclude<DensityMode, "custom">,
  DensityPreset
> = {
  high_yield: {
    label: "High-yield cram",
    cardsPerUnit: 0.3,
    blurb:
      "Objectives, bolded emphasis and summary tables only. Related sub-points are folded into one synthesis card.",
  },
  standard: {
    label: "Standard",
    cardsPerUnit: 1,
    blurb:
      "Core definitions, mechanisms and relationships. Conversational and repeated bullets are skipped.",
  },
  exhaustive: {
    label: "Exhaustive",
    cardsPerUnit: 2.5,
    blurb:
      "Every testable detail, every sub-bullet, every step of every pathway. This is what the deck did before this setting existed.",
  },
};

export const DEFAULT_DENSITY: DensityMode = "standard";

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
