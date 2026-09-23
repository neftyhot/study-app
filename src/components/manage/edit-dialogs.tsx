"use client";

/**
 * Editing what was created: a subject's name and term, a deck's name, date and
 * subject, and the name a source file is shown under.
 */
import { useRouter } from "next/navigation";
import { useState, type ComponentProps } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  renameSourceFileAction,
  updateCourseAction,
  updateExamAction,
} from "@/lib/manage/actions";

type TriggerProps = {
  label?: string;
  variant?: "ghost" | "outline";
  size?: "sm" | "icon-sm";
};

function EditTrigger({
  label = "Edit",
  variant = "ghost",
  size = "sm",
  ...props
}: TriggerProps & ComponentProps<"button">) {
  return (
    <Button variant={variant} size={size} aria-label={label} {...props}>
      <Pencil className="size-3.5" />
      {size === "icon-sm" ? null : label}
    </Button>
  );
}

/** Save, with the busy state and error toast every edit dialog needs. */
function useSave(onDone: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onDone();
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}

export function EditCourseDialog({
  courseId,
  title,
  term,
  ...trigger
}: { courseId: string; title: string; term: string | null } & TriggerProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(title);
  const [termValue, setTermValue] = useState(term ?? "");
  const { busy, run } = useSave(() => setOpen(false));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setName(title);
          setTermValue(term ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <EditTrigger label="Edit subject" {...trigger} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit subject</DialogTitle>
          <DialogDescription>Its decks stay exactly as they are.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => updateCourseAction(courseId, { title: name, term: termValue }),
              "Subject saved",
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`course-name-${courseId}`}>Name</Label>
            <Input
              id={`course-name-${courseId}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`course-term-${courseId}`}>Term (optional)</Label>
            <Input
              id={`course-term-${courseId}`}
              value={termValue}
              placeholder="Fall 2026"
              onChange={(event) => setTermValue(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditExamDialog({
  exam,
  courses,
  ...trigger
}: {
  exam: { id: string; title: string; date: string | null; courseId: string };
  courses: { id: string; title: string }[];
} & TriggerProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(exam.title);
  const [date, setDate] = useState(exam.date ?? "");
  const [courseId, setCourseId] = useState(exam.courseId);
  const { busy, run } = useSave(() => setOpen(false));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTitle(exam.title);
          setDate(exam.date ?? "");
          setCourseId(exam.courseId);
        }
      }}
    >
      <DialogTrigger asChild>
        <EditTrigger label="Edit deck" {...trigger} />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit deck</DialogTitle>
          <DialogDescription>
            Moving it to another subject takes its sources, cards and progress
            with it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              () => updateExamAction(exam.id, { title, date, courseId }),
              "Deck saved",
            );
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={`exam-name-${exam.id}`}>Name</Label>
            <Input
              id={`exam-name-${exam.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`exam-date-${exam.id}`}>Exam date (optional)</Label>
            <Input
              id={`exam-date-${exam.id}`}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          {courses.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor={`exam-course-${exam.id}`}>Subject</Label>
              <Select value={courseId} onValueChange={setCourseId}>
                <SelectTrigger id={`exam-course-${exam.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !title.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameSourceDialog({
  examId,
  fileId,
  filename,
}: {
  examId: string;
  fileId: string;
  filename: string;
}) {
  const shown = (() => {
    try {
      return decodeURIComponent(filename.replace(/\+/g, " "));
    } catch {
      return filename;
    }
  })();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(shown);
  const { busy, run } = useSave(() => setOpen(false));

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setName(shown);
      }}
    >
      <DialogTrigger asChild>
        <EditTrigger label="Rename" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
          <DialogDescription>
            Only the name shown in the app changes; the file itself, and every
            card citing it, stay as they are.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => renameSourceFileAction(examId, fileId, name), "File renamed");
          }}
        >
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
