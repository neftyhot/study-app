"use client";

/**
 * Deck export.
 *
 * Each target loses something on the way out — Quizlet keeps two fields, a CSV
 * keeps no formatting, Anki keeps almost everything. The caveat is shown next
 * to the button rather than discovered after the import, because a student
 * who has already rebuilt a deck elsewhere cannot get the detail back.
 */
import { useState } from "react";
import { Check, Copy, Download, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Format = "anki" | "quizlet" | "remnote" | "csv" | "backup";

const TARGETS: {
  id: Format;
  name: string;
  extension: string;
  keeps: string;
}[] = [
  {
    id: "anki",
    name: "Anki",
    extension: ".apkg",
    keeps:
      "Question, answer, explanation, the points an answer must contain, slide images, and topic tags.",
  },
  {
    id: "quizlet",
    name: "Quizlet",
    extension: "paste",
    keeps:
      "Term and definition only — Quizlet's import box has two columns, so rubrics and citations are dropped.",
  },
  {
    id: "remnote",
    name: "RemNote",
    extension: ".md",
    keeps:
      "A markdown outline: topics as headings, cards as :: and ::: lines, with rubric and source as children.",
  },
  {
    id: "csv",
    name: "CSV / spreadsheet",
    extension: ".csv",
    keeps:
      "Every field as a column: topic, question, answer, explanation, rubric, emphasis and source.",
  },
  {
    id: "backup",
    name: "Full backup",
    extension: ".json",
    keeps:
      "Everything, including review history and extracted source text. This is the one that can rebuild a deck.",
  },
];

export function ExportDialog({
  examId,
  cardCount,
  trigger,
}: {
  examId: string;
  cardCount: number;
  /** Lets the deck page place its own button. */
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<Format>("anki");
  const [term, setTerm] = useState<"tab" | "semicolon">("tab");
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const target = TARGETS.find((item) => item.id === format)!;

  function href(inline = false) {
    if (format === "backup") return `/api/exams/${examId}/export`;
    const params = new URLSearchParams({ format });
    if (format === "quizlet") params.set("term", term);
    if (inline) params.set("inline", "1");
    return `/api/exams/${examId}/export?${params}`;
  }

  async function loadText(nextTerm = term) {
    setLoading(true);
    setCopied(false);
    try {
      const params = new URLSearchParams({
        format: "quizlet",
        term: nextTerm,
        inline: "1",
      });
      const response = await fetch(`/api/exams/${examId}/export?${params}`);
      if (!response.ok) throw new Error("Export failed");
      setText(await response.text());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied — paste it into Quizlet's import box");
    } catch {
      // Clipboard permission can be refused; the textarea is still selectable.
      toast.error("Could not reach the clipboard. Select the text and copy it.");
    }
  }

  function choose(next: Format) {
    setFormat(next);
    setText(null);
    setCopied(false);
    if (next === "quizlet") void loadText();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <FileDown className="size-4" />
            Export deck
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export this deck</DialogTitle>
          <DialogDescription>
            {cardCount} card{cardCount === 1 ? "" : "s"}. Cards you excluded
            from study are left out.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TARGETS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item.id)}
              aria-pressed={format === item.id}
              className={`rounded-md border p-2 text-left text-sm transition-colors ${
                format === item.id
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/60"
              }`}
            >
              <span className="block font-medium">{item.name}</span>
              <span className="text-muted-foreground block text-xs">
                {item.extension}
              </span>
            </button>
          ))}
        </div>

        <p className="text-muted-foreground text-xs">{target.keeps}</p>

        {format === "quizlet" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="term-separator" className="text-sm font-normal">
                Between term and definition
              </Label>
              <Select
                value={term}
                onValueChange={(value) => {
                  const next = value as "tab" | "semicolon";
                  setTerm(next);
                  void loadText(next);
                }}
              >
                <SelectTrigger id="term-separator" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tab">Tab</SelectItem>
                  <SelectItem value="semicolon">Semicolon</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Textarea
              readOnly
              value={loading ? "" : (text ?? "")}
              rows={8}
              className="font-mono text-xs"
              placeholder={loading ? "Building…" : ""}
            />

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void copy()} disabled={!text || loading}>
                {copied ? (
                  <Check className="size-4" />
                ) : loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? "Copied" : "Copy to clipboard"}
              </Button>
              <Button asChild variant="outline">
                <a href={href()} download>
                  <Download className="size-4" />
                  Download .txt
                </a>
              </Button>
            </div>

            <p className="text-muted-foreground text-xs">
              In Quizlet choose <strong>Import from Word, Excel, Google
              Docs</strong>, paste this in, and set the separators to{" "}
              {term === "tab" ? "Tab" : "Semicolon"} and New line.
            </p>
          </div>
        ) : (
          <Button asChild className="w-fit">
            <a href={href()} download>
              <Download className="size-4" />
              Download {target.extension === "paste" ? ".txt" : target.extension}
            </a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
