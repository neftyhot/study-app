import { LectureStudio } from "@/components/lectures/lecture-studio";
import { listLectures } from "@/lib/lectures";

export default function LecturesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Lectures &amp; Transcripts</h1>
        <p className="text-muted-foreground text-sm">
          Record a lecture, or turn recordings you already have into searchable, timestamped transcripts — on
          this computer, with no internet needed — and add them to a deck as notes.
        </p>
      </div>

      <LectureStudio
        lectures={listLectures().map((lecture) => ({
          ...lecture,
          pending: Boolean(lecture.pending),
        }))}
      />
    </div>
  );
}
