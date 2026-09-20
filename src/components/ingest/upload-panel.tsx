"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type DragEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type UploadResult = {
  filename: string;
  status: "ready" | "failed" | "rejected" | "unchanged";
  unitCount?: number;
  objectiveCount?: number;
  error?: string;
  warnings?: { index: number | null; message: string }[];
};

export function UploadPanel({ examId }: { examId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState("slides");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;

    const body = new FormData();
    body.set("role", role);
    for (const file of Array.from(files)) body.append("files", file);

    setBusy(true);
    setResults([]);

    try {
      const response = await fetch(`/api/exams/${examId}/files`, {
        method: "POST",
        body,
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Upload failed");
        return;
      }

      setResults(payload.results);

      const ready = payload.results.filter(
        (r: UploadResult) => r.status === "ready",
      ).length;
      if (ready > 0) toast.success(`Extracted ${ready} file(s)`);

      // Refresh the server components so counts and the source list update.
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!busy) void upload(event.dataTransfer.files);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add source files</CardTitle>
        <CardDescription>
          PDF and PPTX. Slide text, tables, and speaker notes are extracted and
          indexed by slide number.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={role} onValueChange={setRole} disabled={busy}>
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slides">Lecture slides</SelectItem>
              <SelectItem value="study_guide">Study guide</SelectItem>
              <SelectItem value="notes">Notes</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            A study guide becomes the objective checklist; slides and notes
            supply the answers.
          </p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-lg border border-dashed p-8 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
            busy && "opacity-60",
          )}
        >
          {busy ? (
            <Loader2 className="text-muted-foreground mx-auto size-6 animate-spin" />
          ) : (
            <Upload className="text-muted-foreground mx-auto size-6" />
          )}
          <p className="mt-3 text-sm">
            {busy ? "Extracting…" : "Drop files here, or"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.pptx"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>

        {results.length > 0 ? (
          <ul className="space-y-2">
            {results.map((result) => (
              <li
                key={result.filename}
                className="flex items-start gap-2 rounded-md border p-3 text-sm"
              >
                {result.status === "failed" || result.status === "rejected" ? (
                  <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                )}
                <div className="min-w-0">
                  <p className="font-medium break-all">{result.filename}</p>
                  <p className="text-muted-foreground">
                    {result.status === "ready" &&
                      `${result.unitCount} slides extracted` +
                        (result.objectiveCount
                          ? `, ${result.objectiveCount} objectives`
                          : "")}
                    {result.status === "unchanged" &&
                      "Unchanged — existing cards and progress kept"}
                    {(result.status === "failed" ||
                      result.status === "rejected") &&
                      result.error}
                  </p>
                  {result.warnings && result.warnings.length > 0 ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {result.warnings.length} legibility warning(s) — see the
                      source list.
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
