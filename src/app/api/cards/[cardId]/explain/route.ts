/**
 * A card's explanation, written the first time someone asks for it.
 *
 * Bulk generation leaves `full_explanation` empty on purpose (see
 * `generatedCardSchema`). The first request for a card writes it with the
 * interactive model and stores it; every request after that is answered from
 * SQLite and costs nothing.
 */
import { db } from "@/db";
import { explainCard } from "@/lib/generate/enrich";
import { getProvider } from "@/lib/llm";

export const maxDuration = 60;

export async function POST(
  _request: Request,
  ctx: RouteContext<"/api/cards/[cardId]/explain">,
) {
  const { cardId } = await ctx.params;

  try {
    const result = await explainCard(db, () => getProvider(), cardId);
    if (!result) {
      return Response.json({ error: "That card no longer exists." }, { status: 404 });
    }
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      // No key, no network, or the provider refused: not the server's fault,
      // and the card is unchanged.
      { status: 503 },
    );
  }
}
