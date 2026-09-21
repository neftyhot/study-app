/**
 * What a call cost, so spend is visible while a deck is being built.
 *
 * Prices are USD per million tokens, from Google's published standard paid
 * tier (ai.google.dev/gemini-api/docs/pricing, September 2026). Output is
 * billed including thinking tokens, which `gemini.ts` counts for that reason. They are an estimate for the log, not a bill: cached input,
 * retries that failed before returning usage, and free-tier quota are all
 * ignored. A model not listed here reports tokens with no cost rather than a
 * made-up one.
 */
export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Closed to API keys created after its successor shipped; kept so a run on
  // an older key is still priced.
  "gemini-2.5-flash-lite": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  "gemini-3.5-flash-lite": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
  "gemini-2.5-flash": { inputPerMillion: 0.3, outputPerMillion: 2.5 },
};

export function priceFor(model: string): ModelPrice | undefined {
  return MODEL_PRICES[model];
}

/** Estimated USD, or null when the model's price is unknown. */
export function estimateCost(model: string, usage: TokenUsage): number | null {
  const price = priceFor(model);
  if (!price) return null;
  return (
    (usage.inputTokens * price.inputPerMillion +
      usage.outputTokens * price.outputPerMillion) /
    1_000_000
  );
}

export function formatCost(cost: number | null): string {
  if (cost === null) return "cost unknown";
  // Batches cost fractions of a cent; two significant figures keeps them
  // readable without rounding them all to $0.00.
  return cost < 0.01 ? `$${cost.toPrecision(2)}` : `$${cost.toFixed(4)}`;
}
