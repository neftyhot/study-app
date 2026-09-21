"use client";

/**
 * Drawing the boxes.
 *
 * The student drags over each label on the diagram and types what is under
 * it. Coordinates are kept as percentages of the image the whole way through —
 * the SVG uses a 0-100 viewBox so a box means the same thing at any window
 * size, on any screen, and after the page is re-rendered at another scale.
 */
import { useRef, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OcclusionMask } from "@/db/schema";
import { createDrillAction, updateDrillAction } from "@/lib/diagrams/actions";
import {
  isUsableRect,
  rectFromDrag,
  readingOrder,
  type Point,
  type Rect,
} from "@/lib/diagrams/masks";

export function OcclusionEditor({
  examId,
  slideId,
  imageUrl,
  topic,
  drillId,
  initialMasks = [],
  onSaved,
}: {
  examId: string;
  slideId: string | null;
  imageUrl: string;
  topic: string | null;
  /** Present when editing an existing drill rather than building one. */
  drillId?: string;
  initialMasks?: OcclusionMask[];
  onSaved?: (drillId: string) => void;
}) {
  const surface = useRef<SVGSVGElement>(null);
  const [masks, setMasks] = useState<OcclusionMask[]>(initialMasks);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [origin, setOrigin] = useState<Point | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Pointer position as a percentage of the image, which is what is stored. */
  function toPercent(event: React.PointerEvent): Point {
    const box = surface.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    };
  }

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    // Only a drag on bare image starts a new box; a press on an existing one
    // selects it instead, so labels can be corrected without redrawing.
    if ((event.target as SVGElement).dataset?.maskId) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toPercent(event);
    setOrigin(point);
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
    setSelected(null);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!origin) return;
    setDraft(rectFromDrag(origin, toPercent(event)));
  }

  function onPointerUp() {
    if (draft && isUsableRect(draft)) {
      const mask: OcclusionMask = {
        id: crypto.randomUUID(),
        ...draft,
        label: "",
      };
      setMasks((current) => [...current, mask]);
      setSelected(mask.id);
      // The label is the point of the box, so the cursor goes there next.
      requestAnimationFrame(() =>
        document.getElementById(`label-${mask.id}`)?.focus(),
      );
    }

    setDraft(null);
    setOrigin(null);
  }

  function update(id: string, patch: Partial<OcclusionMask>) {
    setMasks((current) =>
      current.map((mask) => (mask.id === id ? { ...mask, ...patch } : mask)),
    );
  }

  function remove(id: string) {
    setMasks((current) => current.filter((mask) => mask.id !== id));
    setSelected((current) => (current === id ? null : current));
  }

  async function save() {
    setSaving(true);
    try {
      const result = drillId
        ? await updateDrillAction(examId, drillId, masks)
        : await createDrillAction({
            examId,
            sourceSlideId: slideId,
            masks,
            topic,
          });

      if (!result.ok) {
        // Every problem at once, rather than one per attempted save.
        for (const problem of result.problems) toast.error(problem);
        return;
      }

      toast.success(
        drillId
          ? "Drill updated"
          : `Drill saved — ${masks.length} label${masks.length === 1 ? "" : "s"} to recall`,
      );
      onSaved?.(result.drillId);
    } finally {
      setSaving(false);
    }
  }

  const ordered = readingOrder(masks);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-md border">
        {/* eslint-disable-next-line @next/next/no-img-element -- a rendered
            page, served by a route handler at its own natural size. */}
        <img src={imageUrl} alt="" className="block w-full select-none" />

        <svg
          ref={surface}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {masks.map((mask, i) => (
            <g key={mask.id}>
              <rect
                data-mask-id={mask.id}
                x={mask.x}
                y={mask.y}
                width={mask.width}
                height={mask.height}
                onPointerDown={() => setSelected(mask.id)}
                className={
                  selected === mask.id
                    ? "fill-primary/70 stroke-primary cursor-pointer"
                    : "fill-foreground/60 stroke-background/80 cursor-pointer"
                }
                // Percentages on both axes, so a hairline stays a hairline.
                strokeWidth={0.4}
                vectorEffect="non-scaling-stroke"
              />
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
            </g>
          ))}

          {draft ? (
            <rect
              x={draft.x}
              y={draft.y}
              width={draft.width}
              height={draft.height}
              className="fill-primary/30 stroke-primary"
              strokeWidth={0.4}
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
      </div>

      <p className="text-muted-foreground text-xs">
        Drag a box over each label you want to hide, then type what is
        underneath it. The numbers follow the order the drill asks them in.
      </p>

      {masks.length > 0 ? (
        <div className="space-y-2">
          {ordered.map((mask, i) => (
            <div key={mask.id} className="flex items-center gap-2">
              <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                {i + 1}
              </span>
              <Label htmlFor={`label-${mask.id}`} className="sr-only">
                Label for box {i + 1}
              </Label>
              <Input
                id={`label-${mask.id}`}
                value={mask.label}
                placeholder="What is hidden here?"
                onChange={(event) => update(mask.id, { label: event.target.value })}
                onFocus={() => setSelected(mask.id)}
                className="h-9"
              />
              <Input
                value={mask.tip ?? ""}
                placeholder="Hint (optional)"
                onChange={(event) =>
                  update(mask.id, { tip: event.target.value || undefined })
                }
                className="h-9 max-w-40"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove box ${i + 1}`}
                onClick={() => remove(mask.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={saving || masks.length === 0}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : null}
          {drillId ? "Save changes" : "Create drill"}
        </Button>
        {masks.length > 0 ? (
          <Button variant="ghost" onClick={() => setMasks([])} disabled={saving}>
            Clear all
          </Button>
        ) : null}
      </div>
    </div>
  );
}
