"use client";

/**
 * The shapes a flashcard can take while studying, besides the classic one
 * where the answer opens beneath the question: a card that turns over, and
 * a pile to swipe cards off.
 */
import { useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Whether a press landed on something that does its own thing. */
function isInteractive(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "button, a, input, textarea, select, label, [role='button'], [role='link'], [role='menuitem'], [contenteditable='true']",
    ) !== null
  );
}

/** Whether the press was the end of selecting text, not a tap. */
function selecting(): boolean {
  return (window.getSelection()?.toString() ?? "").length > 0;
}

/**
 * A card that turns over in the middle of the page. Clicking it (anywhere
 * but a button) turns it; the face turned away cannot be tabbed into.
 */
export function FlipCard({
  cardKey,
  revealed,
  onToggle,
  front,
  back,
  className,
  faceClassName,
}: {
  /** A new key starts the next card face up, without turning. */
  cardKey: string;
  revealed: boolean;
  onToggle: () => void;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  faceClassName?: string;
}) {
  const face =
    "bg-card text-card-foreground [grid-area:1/1] flex flex-col rounded-xl border p-6 shadow-sm [backface-visibility:hidden]";
  return (
    <div className={cn("[perspective:1600px]", className)}>
      <div
        key={cardKey}
        onClick={(event) => {
          if (isInteractive(event.target) || selecting()) return;
          onToggle();
        }}
        className={cn(
          "grid cursor-pointer transition-transform duration-500 ease-out [transform-style:preserve-3d] motion-reduce:transition-none",
          revealed && "[transform:rotateY(180deg)]",
        )}
      >
        <div
          inert={revealed}
          aria-hidden={revealed}
          className={cn(face, "min-h-64 items-center justify-center gap-4 text-center", faceClassName)}
        >
          {front}
        </div>
        <div
          inert={!revealed}
          aria-hidden={!revealed}
          className={cn(face, "min-h-64 justify-center gap-3 [transform:rotateY(180deg)]", faceClassName)}
        >
          {back}
        </div>
      </div>
    </div>
  );
}

const SWIPE_THRESHOLD = 120;
const DRAG_START = 8;

/**
 * The top card of a pile. Tap it to see the answer; once it shows, drag it
 * right if you knew it or left if you missed it. The buttons still work
 * for anyone who would rather not drag.
 */
export function SwipeCard({
  cardKey,
  revealed,
  onReveal,
  onSwipe,
  behind,
  children,
  className,
}: {
  cardKey: string;
  revealed: boolean;
  onReveal: () => void;
  onSwipe: (direction: "right" | "left") => void;
  /** How many cards to draw under this one, up to two. */
  behind: number;
  children: ReactNode;
  className?: string;
}) {
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; pointer: number; active: boolean } | null>(null);
  const offset = useRef(0);
  const dragged = useRef(false);

  function end() {
    const moved = offset.current;
    drag.current = null;
    offset.current = 0;
    setDx(0);
    if (moved > SWIPE_THRESHOLD) onSwipe("right");
    else if (moved < -SWIPE_THRESHOLD) onSwipe("left");
  }

  const tint = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);

  return (
    <div className={cn("relative pb-4", className)}>
      {behind >= 2 ? (
        <div
          aria-hidden
          className="bg-card absolute inset-x-6 top-4 bottom-0 rounded-xl border opacity-60 shadow-sm"
        />
      ) : null}
      {behind >= 1 ? (
        <div
          aria-hidden
          className="bg-card absolute inset-x-3 top-2 bottom-2 rounded-xl border opacity-80 shadow-sm"
        />
      ) : null}
      <div
        key={cardKey}
        style={
          dx !== 0
            ? { transform: `translateX(${dx}px) rotate(${dx / 24}deg)` }
            : undefined
        }
        onPointerDown={(event) => {
          if (!revealed || isInteractive(event.target) || event.button !== 0) return;
          drag.current = { x: event.clientX, pointer: event.pointerId, active: false };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current) return;
          const delta = event.clientX - current.x;
          if (!current.active) {
            if (Math.abs(delta) < DRAG_START) return;
            current.active = true;
            event.currentTarget.setPointerCapture(current.pointer);
          }
          offset.current = delta;
          setDx(delta);
        }}
        onPointerUp={() => {
          if (drag.current?.active) dragged.current = true;
          end();
        }}
        onPointerCancel={() => {
          offset.current = 0;
          end();
        }}
        onClick={(event) => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          if (revealed || isInteractive(event.target) || selecting()) return;
          onReveal();
        }}
        className={cn(
          "bg-card text-card-foreground animate-in fade-in slide-in-from-bottom-2 relative space-y-4 rounded-xl border p-6 shadow-md duration-300 motion-reduce:animate-none",
          revealed ? "cursor-grab touch-pan-y active:cursor-grabbing" : "cursor-pointer",
          dx === 0 && "transition-transform duration-200",
        )}
      >
        {dx !== 0 ? (
          <div
            aria-hidden
            style={{ opacity: tint }}
            className={cn(
              "pointer-events-none absolute inset-0 flex items-start rounded-xl p-4",
              dx > 0
                ? "justify-end bg-emerald-500/10"
                : "justify-start bg-red-500/10",
            )}
          >
            <span
              className={cn(
                "rounded-md border-2 px-2 py-0.5 text-sm font-bold tracking-wide uppercase",
                dx > 0
                  ? "border-emerald-600 text-emerald-600"
                  : "border-red-600 text-red-600",
              )}
            >
              {dx > 0 ? "Knew it" : "Missed"}
            </span>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}
