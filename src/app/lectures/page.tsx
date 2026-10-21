import { LecturesBetaNotice } from "@/components/lectures/beta-notice";
import { LectureStudio } from "@/components/lectures/lecture-studio";
import { Badge } from "@/components/ui/badge";
import { listLectures } from "@/lib/lectures";
import { LECTURES_BETA_KEY } from "@/lib/lectures/format";
import { readSetting } from "@/lib/settings";

export default function LecturesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          Lectures &amp; Transcripts
          <Badge variant="secondary">Beta</Badge>
        </h1>
        <p className="text-muted-foreground text-sm">
          Record a lecture, or turn recordings you already have into searchable, timestamped transcripts — on
          this computer, with no internet needed — and add them to a deck as notes.
        </p>
      </div>

      <LecturesBetaNotice acknowledged={readSetting(LECTURES_BETA_KEY) !== null} />

      <LectureStudio
        lectures={listLectures().map((lecture) => ({
          ...lecture,
          pending: Boolean(lecture.pending),
        }))}
      />
    </div>
  );
}
