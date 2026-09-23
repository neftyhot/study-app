/**
 * Seeded randomness, shared by anything that has to shuffle.
 *
 * Seeded rather than bare `Math.random` so a shuffled deck or a set of MCQ
 * options can be reproduced exactly in a test; the app passes no seed and gets
 * ordinary randomness.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed?: number): T[] {
  const random = seed === undefined ? Math.random : mulberry32(seed);
  const result = [...items];

  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

/**
 * Where the correct option goes in each of a run of multiple-choice questions.
 *
 * Chance alone is not enough over a twenty-question paper: independent draws
 * routinely leave one letter with seven answers and another with two, and a
 * student notices. So positions are dealt like cards — each question takes a
 * random slot among those used least so far — which keeps every slot within
 * one of every other while no single answer's position can be predicted.
 *
 * `optionCounts[i]` is how many options question `i` has; the result gives,
 * for each, an index below that count.
 */
export function dealPositions(
  optionCounts: readonly number[],
  seed?: number,
): number[] {
  const random = seed === undefined ? Math.random : mulberry32(seed);
  const used: number[] = [];

  return optionCounts.map((count) => {
    if (count <= 1) return 0;
    for (let slot = used.length; slot < count; slot += 1) used[slot] = 0;

    const least = Math.min(...used.slice(0, count));
    const open = [...Array(count).keys()].filter((slot) => used[slot] === least);
    const slot = open[Math.floor(random() * open.length)];

    used[slot] += 1;
    return slot;
  });
}
