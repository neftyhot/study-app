import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { TranscriptView } from "@/components/lectures/transcript-view";
import { getLecture, listLectureDecks } from "@/lib/lectures";
import { listCoursesWithExams } from "@/lib/queries";

export default async function LecturePage(props: PageProps<"/lectures/[id]">) {
  const { id } = await props.params;

  const lecture = getLecture(id);
  if (!lecture) notFound();

  const courses = await listCoursesWithExams();

  return (
    <div className="space-y-6">
      <Link
        href="/lectures"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        Lectures &amp; Transcripts
      </Link>

      <TranscriptView
        lecture={{
          id: lecture.id,
          title: lecture.title,
          durationSeconds: lecture.durationSeconds,
          createdAt: lecture.createdAt,
          fullText: lecture.fullText,
          segments: lecture.segments,
          hasAudio: Boolean(lecture.audioPath),
          untranscribed: lecture.transcriptStatus === "pending",
        }}
        decks={courses.flatMap((course) =>
          course.exams.map((exam) => ({
            id: exam.id,
            title: exam.title,
            courseTitle: course.title,
          })),
        )}
        links={listLectureDecks(id)}
      />
    </div>
  );
}
