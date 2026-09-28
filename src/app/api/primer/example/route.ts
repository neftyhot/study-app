/**
 * "Another example" for a study-guide concept: written with the interactive
 * model when the student asks, then kept on the section.
 */
import { db } from "@/db";
import { getProvider } from "@/lib/llm";
import { anotherExample } from "@/lib/primer";

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
    const result = await anotherExample(db, () => getProvider(undefined, "interactive"), sectionId);
    if (!result) {
      return Response.json({ error: "That section no longer exists." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
