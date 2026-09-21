"use client";

/**
 * Answering a diagram.
 *
 * The labels are covered; clicking one uncovers it and asks whether it was
 * actually recalled. Nothing is graded until every box has an answer, and a
 * box that was revealed without being answered counts as missed — uncovering
 * a label is not remembering it.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, EyeOff, Lightbulb, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OcclusionMask } from "@/db/schema";
import { gradeDrillAction } from "@/lib/diagrams/actions";
import { readingOrder, type MaskResult } from "@/lib/diagrams/masks";

export type DrillCard = {
  id: string;
  flashcardId: string;
  question: string;
  topic: string;
  imageUrl: string;
  masks: OcclusionMask[];
  sourceLabel: string | null;
};

export function DrillRunner({
  examId,
  drills,
}: {
  examId: string;
  drills: DrillCard[];
}) {
  const [index, setIndex] = useState(0);
  const drill = drills[index];

  if (!drill) return null;

  return (
    <DrillBoard
      // Remounting per drill is deliberate: reveals and results belong to one
      // diagram, and carrying them across would credit the next one.
      key={drill.id}
      examId={examId}
      drill={drill}
      position={index + 1}
      total={drills.length}
      onNext={
        index + 1 < drills.length ? () => setIndex((i) => i + 1) : undefined
      }
    />
  );
}

function DrillBoard({
  examId,
  drill,
  position,
  total,
  onNext,
}: {
  examId: string;
  drill: DrillCard;
  position: number;
  total: number;
  onNext?: () => void;
}) {
  const masks = useMemo(() => readingOrder(drill.masks), [drill.masks]);

  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, MaskResult>>({});
  const [hinted, setHinted] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const [outcome, setOutcome] = useState<{
    recalled: number;
    missed: number;
    grade: string;
  } | null>(null);

  const current = masks[focus];
  const answered = Object.keys(results).length;
  const complete = answered === masks.length;

  const reveal = useCallback((id: string) => {
    setRevealed((current) => new Set(current).add(id));
  }, []);

  const answer = useCallback(
    (id: string, result: MaskResult) => {
      setResults((current) => ({ ...current, [id]: result }));
      setRevealed((current) => new Set(current).add(id));
      // Move on to the next box that still needs an answer.
      setFocus((current) => {
        for (let step = 1; step <= masks.length; step++) {
          const next = (current + step) % masks.length;
          if (!results[masks[next].id] && masks[next].id !== id) return next;
        }
        return current;
      });
    },
    [masks, results],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;

      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          setFocus((i) => (i + 1) % masks.length);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          setFocus((i) => (i - 1 + masks.length) % masks.length);
          break;
        case "Enter":
        case " ":
          event.preventDefault();
          reveal(masks[focus].id);
          break;
        case "1":
          answer(masks[focus].id, "recalled");
          break;
        case "2":
          answer(masks[focus].id, "missed");
          break;
        default:
          return;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [masks, focus, reveal, answer]);

  async function finish() {
    const result = await gradeDrillAction(
      examId,
      drill.flashcardId,
      masks,
      results,
    );
    setOutcome(result);
    toast.success(
      `${result.recalled} of ${masks.length} recalled — graded ${result.grade}`,
    );
  }

  const allRevealed = revealed.size === masks.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{drill.question}</p>
          <p className="text-muted-foreground text-xs">
            {drill.topic}
            {drill.sourceLabel ? ` · ${drill.sourceLabel}` : ""} · diagram{" "}
            {position} of {total}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {answered} of {masks.length} answered
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRevealed(allRevealed ? new Set() : new Set(masks.map((m) => m.id)))
            }
          >
            {allRevealed ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
            {allRevealed ? "Hide all" : "Reveal all"}
          </Button>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-md border">
        {/* eslint-disable-next-line @next/next/no-img-element -- a rendered
            page, served by a route handler at its own natural size. */}
        <img src={drill.imageUrl} alt={drill.question} className="block w-full" />

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full"
        >
          {masks.map((mask, i) => {
            const isRevealed = revealed.has(mask.id);
            const result = results[mask.id];

            return (
              <g key={mask.id}>
                {!isRevealed ? (
                  <rect
                    x={mask.x}
                    y={mask.y}
                    width={mask.width}
                    height={mask.height}
                    onClick={() => {
                      setFocus(i);
                      reveal(mask.id);
                    }}
                    className={`cursor-pointer ${
                      focus === i
                        ? "fill-primary stroke-primary-foreground"
                        : "fill-foreground/85 stroke-background/70"
                    }`}
                    strokeWidth={0.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  // Revealed: only an outline, so the label underneath is
                  // legible but it is still obvious which box it was.
                  <rect
                    x={mask.x}
                    y={mask.y}
                    width={mask.width}
                    height={mask.height}
                    className={`fill-none ${
                      result === "recalled"
                        ? "stroke-emerald-500"
                        : result === "missed"
                          ? "stroke-destructive"
                          : "stroke-primary"
                    }`}
                    strokeWidth={0.6}
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {!isRevealed ? (
                  <text
                    x={mask.x + mask.width / 2}
                    y={mask.y + mask.height / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="fill-background pointer-events-none"
                    style={{ fontSize: 3 }}
                  >
                    {i + 1}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      {current ? (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="text-muted-foreground">Box {focus + 1}:</span>{" "}
              {revealed.has(current.id) ? (
                <strong>{current.label}</strong>
              ) : (
                <span className="text-muted-foreground">
                  still covered — recall it, then uncover it
                </span>
              )}
            </p>

            {current.tip && !revealed.has(current.id) ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHinted((c) => new Set(c).add(current.id))}
              >
                <Lightbulb className="size-4" />
                {hinted.has(current.id) ? current.tip : "Hint"}
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {!revealed.has(current.id) ? (
              <Button onClick={() => reveal(current.id)}>
                <Eye className="size-4" />
                Uncover it
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => answer(current.id, "recalled")}
                >
                  <Check className="size-4 text-emerald-600" />
                  I recalled it
                </Button>
                <Button
                  variant="outline"
                  onClick={() => answer(current.id, "missed")}
                >
                  <X className="text-destructive size-4" />
                  I missed it
                </Button>
              </>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            Arrow keys move between boxes · Enter uncovers · 1 recalled · 2
            missed
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {outcome ? (
          <p className="text-sm">
            <strong>
              {outcome.recalled} of {masks.length}
            </strong>{" "}
            recalled — this card was graded{" "}
            <strong>{outcome.grade}</strong> and scheduled accordingly.
          </p>
        ) : (
          <Button onClick={() => void finish()} disabled={!complete}>
            {complete
              ? "Grade this diagram"
              : `Answer ${masks.length - answered} more`}
          </Button>
        )}

        {onNext ? (
          <Button variant="outline" onClick={onNext}>
            Next diagram
          </Button>
        ) : null}
      </div>
    </div>
  );
}
