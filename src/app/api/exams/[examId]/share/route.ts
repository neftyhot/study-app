/**
 * A deck as a `.meganstudy` file to hand to a friend: cards, and the study
 * guide only with `?guide=1`. No review history (see `@/lib/share/meganstudy`).
 */
import { db } from "@/db";
import { SHARE_MIME, buildShareFile, shareFilename } from "@/lib/share/meganstudy";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/exams/[examId]/share">,
) {
  const { examId } = await ctx.params;
  const includeGuide = new URL(request.url).searchParams.get("guide") === "1";
  const file = buildShareFile(db, examId, { includeGuide });
  if (!file) return Response.json({ error: "Exam not found" }, { status: 404 });
  if (file.deck.cards.length === 0) {
    return Response.json({ error: "This deck has no cards to share." }, { status: 400 });
  }

  return new Response(JSON.stringify(file), {
    headers: {
      "content-type": `${SHARE_MIME}; charset=utf-8`,
      "content-disposition": `attachment; filename="${shareFilename(file.deck.title)}"`,
      "x-card-count": String(file.deck.cards.length),
    },
  });
}
