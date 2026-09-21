"use server";

import { getProvider } from "@/lib/llm";

import {
  applyFilters,
  runSearch,
  type SearchFilters,
  type SearchResult,
} from "./docs";
import { loadCorpus } from "./index";
import { snippet } from "./match";
import { semanticSearch } from "./semantic";

/** Instant search: no model, no network, no waiting. */
export async function searchEverything(
  query: string,
  filters: SearchFilters = {},
): Promise<SearchResult[]> {
  return runSearch(await loadCorpus(), query, filters);
}

export type SemanticSearchResult =
  | { ok: true; results: SearchResult[] }
  | { ok: false; error: string };

/**
 * Model-backed search, run only when asked.
 *
 * Cards only: an objective or a slide is found by its words, but "the thing
 * that carries urine out of the kidney" is a question about the material, and
 * the cards are what answer questions.
 */
export async function searchWithModel(
  query: string,
  filters: SearchFilters = {},
): Promise<SemanticSearchResult> {
  const corpus = await loadCorpus();
  const filtered = applyFilters(corpus, { ...filters, kinds: ["card"] });

  let provider;
  try {
    provider = getProvider();
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "No model is configured. Choose one in Settings.",
    };
  }

  try {
    const hits = await semanticSearch(
      provider,
      query,
      filtered.map((doc) => ({
        id: doc.id,
        text: `${doc.topic ? `${doc.topic}: ` : ""}${doc.title} — ${doc.body}`,
      })),
    );

    const byId = new Map(filtered.map((doc) => [doc.id, doc]));

    return {
      ok: true,
      results: hits.flatMap((hit, index) => {
        const doc = byId.get(hit.id);
        if (!doc) return [];

        return [
          {
            doc,
            kind: "semantic" as const,
            // Rank order from the model, expressed as a descending score.
            score: 1 - index / Math.max(hits.length, 1),
            snippet: snippet(doc.haystack, query),
            reason: hit.reason,
          },
        ];
      }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The search failed.",
    };
  }
}
