/** "Midterm 1: Cells!" → "midterm-1-cells", for a filename a student will recognise. */
export function fileSlug(title: string, fallback: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || fallback
  );
}
