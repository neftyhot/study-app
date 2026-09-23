import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Presentation, TriangleAlert } from "lucide-react";

import { CreateDrillDialog } from "@/components/diagrams/create-drill-dialog";
import { UploadPanel } from "@/components/ingest/upload-panel";
import { TutorPanel } from "@/components/tutor/tutor-panel";
import { SourceFileActions } from "@/components/manage/source-file-actions";
import { RenameSourceDialog } from "@/components/manage/edit-dialogs";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { drillCountsBySlide } from "@/lib/diagrams";
import { getExam, listObjectives, listSourceFiles } from "@/lib/queries";

/** Formats a page can be drawn on: the ones that have a page to draw. */
const DRILLABLE = new Set(["pdf", "pptx", "image"]);

/** What one extracted unit is called in each format. */
const UNIT_NOUN: Record<string, string> = {
  pptx: "slides",
  pdf: "pages",
  docx: "sections",
};

const UNIT_NOUN_SINGULAR: Record<string, string> = {
  pptx: "Slide",
  pdf: "Page",
  docx: "Section",
};

const LEGIBILITY_LABEL: Record<string, string> = {
  empty: "No text found",
  image_only: "Image only",
  low_text: "Very little text",
};

export default async function SourcesPage(
  props: PageProps<"/exams/[examId]/sources">,
) {
  const { examId } = await props.params;
  const exam = await getExam(examId);
  if (!exam) notFound();

  const [files, objectives] = await Promise.all([
    listSourceFiles(examId),
    listObjectives(examId),
  ]);

  const drillCounts = drillCountsBySlide(db, examId);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Link
          href={`/exams/${examId}`}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          ← {exam.title}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
      </div>

      <UploadPanel examId={examId} />

      {objectives.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Study-guide objectives
              <Badge variant="secondary" className="ml-2">
                {objectives.length}
              </Badge>
            </CardTitle>
            <CardDescription>
              These drive the coverage checklist in Phase 3.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {objectives.map((objective) => (
                <li key={objective.id} className="flex gap-2 text-sm">
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {objective.label ?? objective.orderIndex + 1}.
                  </span>
                  <span>{objective.promptText}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {files.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No source files yet. Upload a deck or study guide to get started.
        </p>
      ) : (
        <div className="space-y-6">
          {files.map((file) => {
            const flagged = file.slides.filter(
              (s) => s.legibilityFlag !== "ok",
            );

            return (
              <Card key={file.id}>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                      {file.fileType === "pptx" ? (
                        <Presentation className="size-4" />
                      ) : (
                        <FileText className="size-4" />
                      )}
                      <span className="break-all">{file.filename}</span>
                      <Badge variant="secondary">{file.role}</Badge>
                      {file.status !== "ready" ? (
                        <Badge variant="destructive">{file.status}</Badge>
                      ) : null}
                    </CardTitle>
                    <div className="flex shrink-0 gap-1">
                      <RenameSourceDialog
                        examId={examId}
                        fileId={file.id}
                        filename={file.filename}
                      />
                      <SourceFileActions
                        examId={examId}
                        fileId={file.id}
                        filename={file.filename}
                      />
                    </div>
                  </div>
                  <CardDescription>
                    {file.unitCount} {UNIT_NOUN[file.fileType] ?? "sections"}
                    {flagged.length > 0
                      ? ` · ${flagged.length} flagged for legibility`
                      : ""}
                    {file.errorMessage ? ` · ${file.errorMessage}` : ""}
                  </CardDescription>
                </CardHeader>

                {file.slides.length > 0 ? (
                  <CardContent className="space-y-3">
                    {file.slides.map((slide) => (
                      <details
                        key={slide.id}
                        id={`slide-${file.id}-${slide.index}`}
                        className="rounded-md border p-3"
                      >
                        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
                          <span className="text-muted-foreground tabular-nums">
                            {UNIT_NOUN_SINGULAR[file.fileType] ?? "Section"}{" "}
                            {slide.index}
                          </span>
                          <span className="truncate">{slide.title ?? ""}</span>
                          {slide.legibilityFlag !== "ok" ? (
                            <Badge
                              variant="outline"
                              className="ml-auto shrink-0 gap-1"
                            >
                              <TriangleAlert className="size-3" />
                              {LEGIBILITY_LABEL[slide.legibilityFlag]}
                            </Badge>
                          ) : null}
                        </summary>

                        <div className="mt-3 space-y-3 text-sm">
                          {slide.rawText ? (
                            <pre className="whitespace-pre-wrap font-sans">
                              {slide.rawText}
                            </pre>
                          ) : (
                            <p className="text-muted-foreground italic">
                              No extractable text.
                            </p>
                          )}

                          {slide.tables.map((table, i) => (
                            // A lecture table can have more columns than a
                            // phone has room for; scrolling it beats pushing
                            // the whole page sideways.
                            <div key={i} className="overflow-x-auto">
                              <table className="w-full border-collapse text-xs">
                                <tbody>
                                  {table.rows.map((row, r) => (
                                    <tr key={r}>
                                      {row.map((cell, c) => (
                                        <td key={c} className="border p-1.5">
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ))}

                          {DRILLABLE.has(file.fileType) ? (
                            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                              <TutorPanel
                                examId={examId}
                                slideId={slide.id}
                                slideLabel={`${UNIT_NOUN_SINGULAR[file.fileType] ?? "Section"} ${slide.index} of ${file.filename}`}
                              />
                              <CreateDrillDialog
                                examId={examId}
                                slideId={slide.id}
                                title={slide.title}
                                unitLabel={`${UNIT_NOUN_SINGULAR[file.fileType] ?? "Section"} ${slide.index}`}
                                existingDrills={drillCounts[slide.id] ?? 0}
                              />
                              {drillCounts[slide.id] ? (
                                <span className="text-muted-foreground text-xs">
                                  {drillCounts[slide.id]} drill
                                  {drillCounts[slide.id] === 1 ? "" : "s"} from
                                  this page
                                </span>
                              ) : null}
                            </div>
                          ) : null}

                          {slide.speakerNotes ? (
                            <div className="bg-muted/50 rounded p-2">
                              <p className="text-muted-foreground mb-1 text-xs font-medium">
                                Speaker notes
                              </p>
                              <pre className="whitespace-pre-wrap font-sans text-xs">
                                {slide.speakerNotes}
                              </pre>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ))}
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
