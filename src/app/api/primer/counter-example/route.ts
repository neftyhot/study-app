/**
 * "What this isn't": a Primer section's counter-example, written the first
 * time someone asks for it with the interactive model and stored on the
 * section. Every request after that is answered from SQLite.
 */
import { db } from "@/db";
import { getProvider } from "@/lib/llm";
import { counterExample } from "@/lib/primer";

export const maxDuration = 60;

export async function POST(request: Request) {
  let sectionId: unknown;
  try {
    ({ sectionId } = await request.json());
  } catch {
    sectionId = undefined;
  }
  if (typeof sectionId !== "string" || !sectionId) {
    return Response.json({ error: "Expected { sectionId }." }, { status: 400 });
  }

  try {
    const result = await counterExample(db, () => getProvider(undefined, "interactive"), sectionId);
    if (!result) {
      return Response.json({ error: "That section no longer exists." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      // No key, no network, or the provider refused: the section is unchanged.
      { status: 503 },
    );
  }
}
