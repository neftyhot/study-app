/**
 * Exam export endpoint (PRD §15).
 *
 * A GET so it can be a plain link the browser downloads, with no client-side
 * blob juggling.
 */
import { db } from "@/db";
import { buildExamExport, exportFilename } from "@/lib/manage/export";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/exams/[examId]/export">,
) {
  const { examId } = await ctx.params;

  const bundle = buildExamExport(db, examId);
  if (!bundle) {
    return Response.json({ error: "Exam not found" }, { status: 404 });
  }

  return new Response(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${exportFilename(bundle.exam.title)}"`,
    },
  });
}
