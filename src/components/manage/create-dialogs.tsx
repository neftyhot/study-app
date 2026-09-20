"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { createCourseAction, createExamAction } from "@/lib/manage/actions";

export function CreateCourseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [term, setTerm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const course = await createCourseAction({ title, term });
      toast.success(`Created ${course.title}`);
      setTitle("");
      setTerm("");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          New subject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a subject</DialogTitle>
          <DialogDescription>
            A subject holds the decks for one class — one per course you are
            taking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="course-title">Name</Label>
            <Input
              id="course-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Human Physiology"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="course-term">Term (optional)</Label>
            <Input
              id="course-term"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Fall 2026"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || title.trim().length === 0}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Create subject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CreateExamDialog({
  courses,
  courseId,
  label = "New deck",
  variant = "outline",
}: {
  courses: { id: string; title: string }[];
  /** Fixed when the dialog is opened from inside one subject. */
  courseId?: string;
  label?: string;
  variant?: "default" | "outline" | "ghost";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(courseId ?? courses[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const exam = await createExamAction({
        courseId: courseId ?? selected,
        title,
        date,
      });
      toast.success(`Created ${exam.title}`);
      setOpen(false);
      setTitle("");
      setDate("");
      router.push(`/exams/${exam.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create");
    } finally {
      setBusy(false);
    }
  }

  const target = courseId ?? selected;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} disabled={courses.length === 0}>
          <Plus className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a deck</DialogTitle>
          <DialogDescription>
            A deck is one exam&apos;s worth of material: its sources, its
            cards, and its review schedule.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {courseId ? null : (
            <div className="space-y-1.5">
              <Label htmlFor="exam-course">Subject</Label>
              <Select value={selected} onValueChange={setSelected}>
                <SelectTrigger id="exam-course">
                  <SelectValue placeholder="Pick a subject" />
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
          )}

          <div className="space-y-1.5">
            <Label htmlFor="exam-title">Name</Label>
            <Input
              id="exam-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Exam 2 — Renal & Endocrine"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="exam-date">Exam date (optional)</Label>
            <Input
              id="exam-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || title.trim().length === 0 || !target}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Create deck
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
