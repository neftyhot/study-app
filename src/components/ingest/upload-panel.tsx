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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
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

  /** Pasted text takes the same ingestion path as an uploaded file. */
  async function paste() {
    setBusy(true);
    try {
      const response = await fetch(`/api/exams/${examId}/paste`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: pasteText, title: pasteTitle, role }),
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Could not add that text");
        return;
      }

      setResults((previous) => [...previous, payload]);
      setPasteText("");
      setPasteTitle("");
      toast.success(`Added ${payload.unitCount} section(s)`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add source material</CardTitle>
        <CardDescription>
          PDF, PPTX, DOCX, TXT, Markdown, RTF, and CSV — or paste text straight
          in. Everything is indexed by slide, page, or section, so every card
          can point back at where its answer came from.
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

        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload files</TabsTrigger>
            <TabsTrigger value="paste">Paste text</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="mt-4">
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
            accept=".pdf,.pptx,.docx,.txt,.md,.markdown,.rtf,.csv"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
          </TabsContent>

          <TabsContent value="paste" className="mt-4 space-y-3">
            <Input
              value={pasteTitle}
              onChange={(event) => setPasteTitle(event.target.value)}
              placeholder="Name it — e.g. Week 4 syllabus"
              disabled={busy}
            />
            <Textarea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder="Paste a syllabus, a study guide, or lecture notes…"
              className="min-h-48 font-mono text-xs"
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || pasteText.trim().length === 0}
                onClick={() => void paste()}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Add pasted text
              </Button>
              <p className="text-muted-foreground text-xs">
                Split at Markdown headings if it has any, otherwise into
                paragraph-sized sections.
              </p>
            </div>
          </TabsContent>
        </Tabs>

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
