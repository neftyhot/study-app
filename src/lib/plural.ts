/** "1 card", "2 cards": a count with its noun, for anything a student reads. */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
