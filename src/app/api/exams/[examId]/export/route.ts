/**
 * Exam export endpoint (PRD §15).
 *
 * A GET so it can be a plain link the browser downloads, with no client-side
 * blob juggling. Without a `format` it returns the full JSON backup it always
 * did; with one it returns that deck rebuilt for another app.
 */
import { db } from "@/db";
import {
  buildDeckExport,
  isExportFormat,
  type QuizletOptions,
} from "@/lib/export";
import { buildExamExport, exportFilename } from "@/lib/manage/export";

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/exams/[examId]/export">,
) {
  const { examId } = await ctx.params;
  const params = new URL(request.url).searchParams;
  const format = params.get("format");

  if (format) {
    if (!isExportFormat(format)) {
      return Response.json({ error: `Unknown format "${format}"` }, { status: 400 });
    }

    const quizlet: QuizletOptions = {
      termSeparator: params.get("term") === "semicolon" ? "semicolon" : "tab",
      rowSeparator: params.get("row") === "blank-line" ? "blank-line" : "newline",
      includeExplanation: params.get("explanation") === "1",
    };

    const ids = params.get("cards");
    const result = await buildDeckExport(db, examId, format, {
      quizlet,
      cardIds: ids ? ids.split(",").filter(Boolean) : undefined,
    });

    if (!result) {
      return Response.json({ error: "Exam not found" }, { status: 404 });
    }

    // The Quizlet modal reads the text to put it on the clipboard, so that one
    // is shown rather than downloaded unless the student asks for a file.
    const disposition =
      params.get("inline") === "1"
        ? "inline"
        : `attachment; filename="${result.filename}"`;

    return new Response(result.body as BodyInit, {
      headers: {
        "content-type": result.contentType,
        "content-disposition": disposition,
        "x-card-count": String(result.cardCount),
      },
    });
  }

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
