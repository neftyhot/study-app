"use client";

/**
 * The tools a card or study-guide concept with numbers in it carries: the
 * working, step by step; every number it mentions with what it is; and a
 * calculator to work it forward with.
 */
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Calculator, Delete, Hash, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { evaluate, extractNumbers, formatResult, numericPart } from "@/lib/calc";
import { parseCloze } from "@/lib/cards/cloze";
import type { CalculationStep, NumberGiven } from "@/lib/primer/types";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ Calculations */

/** Every step of the working, in order, each with what it finds. */
export function CalculationsBox({
  steps,
  className,
}: {
  steps: CalculationStep[];
  className?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <aside
      aria-label="Calculations"
      className={cn("bg-background rounded-md border p-3 text-sm", className)}
    >
      <h5 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
        <Calculator className="size-3.5" />
        Calculations
      </h5>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-muted-foreground mt-0.5 text-xs tabular-nums">
              {i + 1}.
            </span>
            <div className="min-w-0">
              {step.label ? (
                <p className="text-muted-foreground text-xs">{step.label}</p>
              ) : null}
              <p className="font-mono break-words tabular-nums">
                {step.expression ? <>{step.expression} = </> : null}
                <strong>{step.result}</strong>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/* ----------------------------------------------------------------- Numbers */

type NumberRow = NumberGiven & { worked?: boolean };

/**
 * The numbers to work with: the ones the card lists, or for an older card,
 * the ones found in its text; plus, once the answer is showing, each
 * result the working reaches.
 */
export function numberRows(
  givens: NumberGiven[],
  text: string,
  calculations: CalculationStep[],
  revealed: boolean,
): NumberRow[] {
  const rows: NumberRow[] = givens.length > 0 ? [...givens] : extractNumbers(text);
  if (revealed) {
    for (const step of calculations) {
      if (step.result && /\d/.test(step.result)) {
        rows.push({ label: step.label || "Worked out", value: step.result, worked: true });
      }
    }
  }
  return rows;
}

/**
 * A flashcard's numbers, without giving the answer away: before it is
 * shown, a cloze card's blanks and anything matching the answer are left out.
 */
export function cardNumberRows(
  card: {
    question: string;
    directAnswer: string;
    cardType: string;
    givens?: NumberGiven[];
    calculations?: CalculationStep[];
  },
  revealed: boolean,
): NumberRow[] {
  const spans = card.cardType === "cloze" ? parseCloze(card.question) : null;
  const shown = spans
    ? spans.filter((span) => revealed || !span.hidden).map((span) => span.text).join(" ")
    : card.question;
  const hidden = spans
    ? spans.filter((span) => span.hidden).map((span) => span.text.toLowerCase())
    : [];
  const answer = card.directAnswer.trim().toLowerCase();
  const givens = (card.givens ?? []).filter((given) => {
    if (revealed) return true;
    const value = given.value.trim().toLowerCase();
    return value !== answer && !hidden.some((text) => text.includes(value));
  });
  return numberRows(givens, shown, card.calculations ?? [], revealed);
}

/** The "Numbers" button and the list it opens. */
export function NumbersPanel({
  rows,
  onPick,
  actions,
  className,
}: {
  rows: NumberRow[];
  /** Pressing a value sends it here, to the calculator. */
  onPick?: (value: string) => void;
  /** Shown beside the button, such as the calculator's. */
  actions?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0 && !actions) return null;
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-2">
        {rows.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Hash className="size-4" />
            {open ? "Hide numbers" : `Numbers (${rows.length})`}
          </Button>
        ) : null}
        {actions}
      </div>
      {open && rows.length > 0 ? (
        <div className="bg-muted/40 rounded-md border p-3">
          <p className="text-muted-foreground mb-2 text-xs">
            Every number here, with what it is.
            {onPick ? " Press one to put it in the calculator." : ""}
          </p>
          <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
            {rows.map((row, i) => (
              <div key={i} className="contents">
                <dt className="text-muted-foreground min-w-0 break-words">
                  {row.label}
                  {row.worked ? (
                    <span className="ml-1.5 text-[10px] tracking-wide uppercase opacity-70">
                      worked out
                    </span>
                  ) : null}
                </dt>
                <dd className="text-right">
                  {onPick && numericPart(row.value) ? (
                    <button
                      type="button"
                      className="hover:bg-accent rounded px-1.5 font-mono font-semibold tabular-nums"
                      onClick={() => onPick(numericPart(row.value)!)}
                      title="Put in the calculator"
                    >
                      {row.value}
                    </button>
                  ) : (
                    <span className="px-1.5 font-mono font-semibold tabular-nums">
                      {row.value}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- Calculator */

export type CalculatorHandle = {
  /** Adds a number to what is typed, opening the calculator if shut. */
  insert: (value: string) => void;
};

const KEYS: { label: string; input: string; wide?: boolean; tone?: "op" | "go" }[] = [
  { label: "(", input: "(", tone: "op" },
  { label: ")", input: ")", tone: "op" },
  { label: "%", input: "%", tone: "op" },
  { label: "÷", input: "/", tone: "op" },
  { label: "7", input: "7" },
  { label: "8", input: "8" },
  { label: "9", input: "9" },
  { label: "×", input: "*", tone: "op" },
  { label: "4", input: "4" },
  { label: "5", input: "5" },
  { label: "6", input: "6" },
  { label: "−", input: "-", tone: "op" },
  { label: "1", input: "1" },
  { label: "2", input: "2" },
  { label: "3", input: "3" },
  { label: "+", input: "+", tone: "op" },
  { label: "0", input: "0" },
  { label: ".", input: "." },
  { label: "xʸ", input: "^", tone: "op" },
  { label: "=", input: "=", tone: "go" },
];

const TYPED = /^[0-9.+\-*/^%()]$/;

/**
 * A calculator that floats in the corner, so it stays put while cards
 * change. While it is open the keyboard types into it: digits, operators,
 * Enter for equals, Backspace, and Escape to close. It takes those keys
 * before the page does, so typing a 1 does not also grade the card.
 */
export function CalculatorPanel({
  open,
  onOpenChange,
  ref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ref?: Ref<CalculatorHandle>;
}) {
  const [expression, setExpression] = useState("");
  const [history, setHistory] = useState<{ expression: string; result: string }[]>([]);

  const preview = useMemo(() => {
    const value = evaluate(expression);
    return value === null ? null : formatResult(value);
  }, [expression]);

  const press = useCallback(
    (input: string) => {
      if (input === "=") {
        const value = evaluate(expression);
        if (value === null) return;
        const result = formatResult(value);
        setHistory((prev) => [{ expression, result }, ...prev].slice(0, 4));
        setExpression(result);
        return;
      }
      setExpression((prev) => (prev + input).slice(0, 200));
    },
    [expression],
  );

  useImperativeHandle(
    ref,
    () => ({
      insert(value: string) {
        onOpenChange(true);
        setExpression((prev) => {
          // After a number, a picked number starts a product rather than
          // running the digits together.
          const joiner = /[\d.)%]$/.test(prev) ? "*" : "";
          return (prev + joiner + value).slice(0, 200);
        });
      },
    }),
    [onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      let handled = true;
      if (TYPED.test(event.key)) press(event.key);
      else if (event.key === "x" || event.key === "X") press("*");
      else if (event.key === "Enter" || event.key === "=") press("=");
      else if (event.key === "Backspace") setExpression((prev) => prev.slice(0, -1));
      else if (event.key === "Delete" || event.key === "c" || event.key === "C") setExpression("");
      else if (event.key === "Escape") onOpenChange(false);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    // Capture, on window: runs before the study deck's own shortcuts.
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, press, onOpenChange]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Calculator"
      className="bg-popover text-popover-foreground fixed right-4 bottom-4 z-50 w-72 rounded-xl border p-3 shadow-lg"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
          <Calculator className="size-3.5" />
          Calculator
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => onOpenChange(false)}
          aria-label="Close calculator"
        >
          <X className="size-4" />
        </Button>
      </div>

      {history.length > 0 ? (
        <ul className="text-muted-foreground mb-1 space-y-0.5 text-right font-mono text-xs tabular-nums">
          {[...history].reverse().map((line, i) => (
            <li key={i} className="truncate">
              {line.expression} = {line.result}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="bg-muted mb-2 rounded-md px-3 py-2 text-right font-mono tabular-nums">
        <div className="min-h-6 text-lg break-all" aria-live="polite">
          {expression || <span className="text-muted-foreground">0</span>}
        </div>
        <div className="text-muted-foreground min-h-4 text-xs">
          {preview !== null && preview !== expression ? `= ${preview}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        <Button variant="ghost" size="sm" onClick={() => setExpression("")}>
          C
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpression((prev) => prev.slice(0, -1))}
          aria-label="Delete last"
        >
          <Delete className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="col-span-2 text-xs"
          disabled={history.length === 0}
          onClick={() => history[0] && press(history[0].result)}
        >
          Ans
        </Button>
        {KEYS.map((key) => (
          <Button
            key={key.label}
            variant={key.tone === "go" ? "default" : key.tone === "op" ? "secondary" : "outline"}
            size="sm"
            className="font-mono"
            onClick={() => press(key.input)}
          >
            {key.label}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-[11px]">
        Type with your keyboard too. Enter for =, Esc to close.
      </p>
    </div>
  );
}
