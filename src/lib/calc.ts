/**
 * The flashcard calculator's arithmetic, and the numbers a card mentions.
 *
 * Parsed by hand rather than handed to `eval` or `Function`: what is typed
 * is only ever arithmetic, so nothing typed can run as code.
 */

export type NumberGivenLike = { label: string; value: string };

type Token =
  | { kind: "num"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "^" | "%" }
  | { kind: "paren"; value: "(" | ")" };

const MAX_LENGTH = 200;

function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  const text = input
    .replace(/[×x·]/g, "*")
    .replace(/÷/g, "/")
    .replace(/[−–]/g, "-")
    .replace(/,/g, "");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
    if (number) {
      tokens.push({ kind: "num", value: Number(number[0]) });
      i += number[0].length;
      continue;
    }
    if ("+-*/^%".includes(ch)) {
      tokens.push({ kind: "op", value: ch as "+" });
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i++;
      continue;
    }
    return null;
  }
  return tokens;
}

/**
 * The value of an arithmetic expression, or null when it is not one.
 *
 * Supports + - * / ^, brackets, unary minus and a trailing % (a hundredth).
 * Brackets left open at the end are closed, as a pocket calculator does.
 */
export function evaluate(input: string): number | null {
  if (!input.trim() || input.length > MAX_LENGTH) return null;
  const tokens = tokenize(input);
  if (!tokens) return null;
  let pos = 0;

  const peek = () => tokens[pos];

  // expression := term (("+" | "-") term)*
  function expression(): number | null {
    let left = term();
    while (left !== null) {
      const t = peek();
      if (t?.kind === "op" && (t.value === "+" || t.value === "-")) {
        pos++;
        const right = term();
        if (right === null) return null;
        left = t.value === "+" ? left + right : left - right;
      } else break;
    }
    return left;
  }

  // term := power (("*" | "/") power | power)*   — "2(3)" multiplies
  function term(): number | null {
    let left = power();
    while (left !== null) {
      const t = peek();
      if (t?.kind === "op" && (t.value === "*" || t.value === "/")) {
        pos++;
        const right = power();
        if (right === null) return null;
        left = t.value === "*" ? left * right : left / right;
      } else if (t?.kind === "paren" && t.value === "(") {
        const right = power();
        if (right === null) return null;
        left = left * right;
      } else break;
    }
    return left;
  }

  // power := unary ("^" power)?   — right-associative
  function power(): number | null {
    const base = unary();
    if (base === null) return null;
    const t = peek();
    if (t?.kind === "op" && t.value === "^") {
      pos++;
      const exponent = power();
      if (exponent === null) return null;
      return Math.pow(base, exponent);
    }
    return base;
  }

  // unary := ("-" | "+") unary | postfix
  function unary(): number | null {
    const t = peek();
    if (t?.kind === "op" && (t.value === "-" || t.value === "+")) {
      pos++;
      const value = unary();
      if (value === null) return null;
      return t.value === "-" ? -value : value;
    }
    return postfix();
  }

  // postfix := primary "%"*
  function postfix(): number | null {
    let value = primary();
    while (value !== null && peek()?.kind === "op" && peek()?.value === "%") {
      pos++;
      value = value / 100;
    }
    return value;
  }

  function primary(): number | null {
    const t = peek();
    if (!t) return null;
    if (t.kind === "num") {
      pos++;
      return t.value;
    }
    if (t.kind === "paren" && t.value === "(") {
      pos++;
      const inner = expression();
      if (inner === null) return null;
      const close = peek();
      if (close?.kind === "paren" && close.value === ")") pos++;
      else if (close) return null;
      return inner;
    }
    return null;
  }

  const result = expression();
  if (result === null || pos !== tokens.length) return null;
  return Number.isFinite(result) ? result : null;
}

/** A result as a calculator shows it: no float noise, no needless zeros. */
export function formatResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const rounded = Number(value.toPrecision(12));
  const text = String(rounded);
  return text.includes("e") ? rounded.toExponential(6).replace(/\.?0+e/, "e") : text;
}

/**
 * The numbers written in a card's text, each with the words just before it
 * as a rough label. For cards written before cards listed their own
 * numbers; a card that lists them uses its list instead.
 */
export function extractNumbers(text: string): NumberGivenLike[] {
  const found: NumberGivenLike[] = [];
  const seen = new Set<string>();
  const pattern =
    /([$£€]?\s?-?\d[\d,]*(?:\.\d+)?|-?\.\d+)(\s?(?:%|percent\b|°[CFK]?|(?:k|m|c|µ|n)?(?:g|m|s|L|l|mol|J|W|V|A|N|Pa|Hz)\b(?:[\/²³]\w*)?|units?\b|hours?\b|hrs?\b|min(?:utes)?\b|days?\b|weeks?\b|months?\b|years?\b|yrs?\b)?)/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].trim();
    const index = match.index ?? 0;
    // A year or a list number is still a number the student may need, so
    // everything is kept; only exact repeats are dropped.
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const before = text
      .slice(Math.max(0, index - 60), index)
      .split(/[.;:!?\n]/)
      .pop()!
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(-5)
      .join(" ")
      .replace(/[,(]+$/, "")
      .trim();
    found.push({ label: before || "Number", value: raw });
    if (found.length >= 40) break;
  }
  return found;
}

/** Whether a card has anything worth a calculator. */
export function hasNumbers(text: string): boolean {
  return /\d/.test(text);
}

/** The plain number in a value like "$1,200" or "15%", for the calculator. */
export function numericPart(value: string): string | null {
  const match = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(value);
  if (!match) return null;
  const plain = match[0].replace(/,/g, "");
  return /%|percent/i.test(value) ? `${plain}%` : plain;
}
