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
import { Check, Copy, Download, FileDown, Loader2, Smartphone } from "lucide-react";
import { toast } from "@/lib/notify";

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

type Format = "share" | "anki" | "quizlet" | "remnote" | "csv" | "backup";

const TARGETS: {
  id: Format;
  name: string;
  extension: string;
  keeps: string;
}[] = [
  {
    id: "share",
    name: "Share with a friend",
    extension: ".meganstudy",
    keeps:
      "The cards and their rubrics, for someone else's Megan Study. Your review history stays with you; they open it as a new deck.",
  },
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
  open: controlledOpen,
  onOpenChange,
}: {
  examId: string;
  cardCount: number;
  /** Lets the deck page place its own button. */
  trigger?: React.ReactNode;
  /** When given, a menu elsewhere opens the dialog and no button is drawn. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : ownOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const [format, setFormat] = useState<Format>("share");
  // Off by default, like the catalog: a guide can quote the course materials.
  const [withGuide, setWithGuide] = useState(false);
  const [term, setTerm] = useState<"tab" | "semicolon">("tab");
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);

  const target = TARGETS.find((item) => item.id === format)!;
  // Only the desktop app can open the share menu; a browser just downloads.
  const canSendToPhone = typeof window !== "undefined" && Boolean(window.studyApp?.shareFiles?.send);

  function href(inline = false) {
    if (format === "backup") return `/api/exams/${examId}/export`;
    if (format === "share") return `/api/exams/${examId}/share${withGuide ? "?guide=1" : ""}`;
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

  /** "Send to my iPhone/iPad": the desktop app's share menu, where AirDrop is. */
  async function sendToPhone() {
    const send = window.studyApp?.shareFiles?.send;
    if (!send) return;
    setSending(true);
    try {
      const response = await fetch(href());
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "The deck couldn't be prepared.");
      }
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
        "deck.meganstudy";
      const sent = await send({ name, text: await response.text() });
      if (sent.result === "error") throw new Error(sent.message);
      if (sent.result === "saved") {
        toast.success("Saved. Open it on your iPhone or iPad from the Files app.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The deck couldn't be sent.");
    } finally {
      setSending(false);
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
      {controlled ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline">
              <FileDown className="size-4" />
              Export deck
            </Button>
          )}
        </DialogTrigger>
      )}

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
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
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
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
              wrap="off"
              // A long deck is thousands of lines: keep the box a fixed size
              // and scroll inside it, both ways, rather than grow the dialog.
              className="h-56 max-h-[40vh] w-full resize-none overflow-auto field-sizing-fixed font-mono text-xs md:text-xs"
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
          <>
          {format === "share" ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-primary mt-0.5 size-4"
                checked={withGuide}
                onChange={(event) => setWithGuide(event.target.checked)}
              />
              <span>
                Include the study guide
                <span className="text-muted-foreground block text-xs">
                  Only if it doesn&apos;t copy your course materials word for word.
                </span>
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button asChild className="w-fit">
              <a href={href()} download>
                <Download className="size-4" />
                Download {target.extension === "paste" ? ".txt" : target.extension}
              </a>
            </Button>
            {format === "share" && canSendToPhone ? (
              <Button
                variant="outline"
                className="w-fit"
                disabled={sending}
                onClick={() => void sendToPhone()}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}
                Send to my iPhone/iPad
              </Button>
            ) : null}
          </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
