"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { setScopeMode } from "@/lib/actions";
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

type Summary = {
  mode: string;
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
}: {
  examId: string;
  scopeMode: "files" | "objectives";
  slideCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<Summary | null>(null);

  async function generate() {
    setBusy(true);
    setSummary(null);

    try {
      const response = await fetch(`/api/exams/${examId}/generate`, {
        method: "POST",
      });
      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error ?? "Generation failed");
        return;
      }

      setSummary(payload);
      toast.success(`Created ${payload.cardsCreated} card(s)`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy(false);
    }
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

          <Button onClick={() => void generate()} disabled={disabled}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {busy ? "Generating…" : "Generate"}
          </Button>
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
    </Card>
  );
}
