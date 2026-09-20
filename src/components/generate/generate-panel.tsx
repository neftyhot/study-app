"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, Layers, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { setIncludeApplication, setScopeMode } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type GenerateMode = "append" | "replace" | "separate";

type Summary = {
  mode: string;
  target?: GenerateMode;
  examId?: string;
  createdExam?: { id: string; title: string } | null;
  cleared?: { deleted: number; kept: number } | null;
  batchCount: number;
  cardsCreated: number;
  cardsRejected: number;
  uncoveredNotes: string[];
  rejections: { reason: string; detail: string; question: string }[];
};

export function GeneratePanel({
  examId,
  scopeMode,
  slideCount,
  existingCards,
  includeApplication,
}: {
  examId: string;
  scopeMode: "files" | "objectives";
  slideCount: number;
  /** PRD §9 higher-order questions, persisted on the exam. */
  includeApplication: boolean;
  /** Cards already in this deck; deciding what to do with them comes first. */
  existingCards: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [asking, setAsking] = useState(false);
  const [application, setApplication] = useState(includeApplication);

  async function generate(mode: GenerateMode) {
    setBusy(true);
    setAsking(false);
    setSummary(null);

    try {
      const response = await fetch(`/api/exams/${examId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Generation failed");
        return;
      }

      setSummary(payload);

      if (payload.createdExam) {
        toast.success(
          `Created ${payload.cardsCreated} card(s) in "${payload.createdExam.title}"`,
        );
        router.push(`/exams/${payload.createdExam.id}`);
        return;
      }

      toast.success(`Created ${payload.cardsCreated} card(s)`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  /** With an empty deck there is nothing to decide, so do not ask. */
  function start() {
    if (existingCards === 0) void generate("append");
    else setAsking(true);
  }

  const disabled = busy || pending || slideCount === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Generate flashcards</CardTitle>
        <CardDescription>
          Every card is checked against its slide before being saved — a card
          whose excerpt is not in your material is discarded, not stored.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            value={scopeMode}
            disabled={disabled}
            onValueChange={(value) =>
              startTransition(async () => {
                await setScopeMode(examId, value as "files" | "objectives");
              })
            }
          >
            <SelectTrigger className="sm:w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="files">Cover everything in files</SelectItem>
              <SelectItem value="objectives">Study-guide focus</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={start} disabled={disabled}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {busy ? "Generating…" : "Generate"}
          </Button>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="application"
            checked={application}
            disabled={disabled}
            onCheckedChange={(value) => {
              const next = value === true;
              setApplication(next);
              startTransition(async () => {
                await setIncludeApplication(examId, next);
              });
            }}
          />
          <div className="space-y-0.5">
            <Label htmlFor="application" className="text-sm font-normal">
              Include application / higher-order questions
            </Label>
            <p className="text-muted-foreground text-xs">
              Adds perturbation (&quot;what if this step is blocked?&quot;),
              directional (&quot;what happens when Y rises?&quot;), and scenario
              cards on top of the factual ones. They still have to quote your
              material.
            </p>
          </div>
        </div>

        {slideCount === 0 ? (
          <p className="text-muted-foreground text-sm">
            Upload and ingest slides first.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            {slideCount} slides available. Generation runs in batches and may
            take a minute.
          </p>
        )}

        {summary?.cleared ? (
          <p className="text-muted-foreground text-xs">
            Replaced {summary.cleared.deleted} generated card(s)
            {summary.cleared.kept > 0
              ? `; kept ${summary.cleared.kept} you had edited`
              : ""}
            .
          </p>
        ) : null}

        {summary ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              <strong>{summary.cardsCreated}</strong> cards created across{" "}
              {summary.batchCount} batch(es)
              {summary.cardsRejected > 0
                ? `, ${summary.cardsRejected} rejected`
                : ""}
              .
            </p>

            {summary.uncoveredNotes.length > 0 ? (
              <div>
                <p className="font-medium">Not covered by your material</p>
                <ul className="text-muted-foreground list-disc pl-5">
                  {summary.uncoveredNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {summary.rejections.length > 0 ? (
              <details>
                <summary className="cursor-pointer font-medium">
                  Rejected cards ({summary.rejections.length})
                </summary>
                <ul className="text-muted-foreground mt-2 space-y-1.5">
                  {summary.rejections.map((rejection, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">
                        {rejection.reason}
                      </span>{" "}
                      — {rejection.question}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </CardContent>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>This deck already has cards</DialogTitle>
            <DialogDescription>
              {existingCards} card{existingCards === 1 ? "" : "s"} are already
              here. Generating again in a different mode would otherwise stack
              a second set on top of them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Choice
              icon={<RefreshCw className="size-4" />}
              title="Replace them"
              body="Delete the generated cards and build fresh. Cards you edited yourself are kept."
              onClick={() => void generate("replace")}
            />
            <Choice
              icon={<Copy className="size-4" />}
              title="Make a separate deck"
              body="Copy the sources into a second deck and generate there. This deck is left exactly as it is."
              onClick={() => void generate("separate")}
            />
            <Choice
              icon={<Layers className="size-4" />}
              title="Add to this deck"
              body="Keep both sets together. Identical questions are skipped, but two cards covering the same fact in different words will both stay."
              onClick={() => void generate("append")}
            />
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function Choice({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-muted/60 focus-visible:ring-ring w-full rounded-md border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </span>
      <span className="text-muted-foreground mt-1 block text-xs">{body}</span>
    </button>
  );
}
