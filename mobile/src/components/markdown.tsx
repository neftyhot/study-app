/**
 * What the tutor wrote, drawn as formatting instead of literal `**` and `##`.
 *
 * A small reader for the Markdown the tutor actually writes — headings, bold,
 * italics, lists, quotes, code and simple tables — so the phone doesn't carry
 * the desktop's full Markdown stack. Everything becomes React elements; no
 * HTML from the reply is ever injected, and links open outside the app.
 */
import { Fragment, type ReactNode } from "react";

export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "rule" };

const LIST_ITEM = /^\s*(?:[-*+•]|(\d+)[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Splits a reply into blocks. Exported for the tests. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith("```"); i++) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith(">"); i++) quote.push(lines[i].trim().replace(/^>\s?/, ""));
      i--;
      blocks.push({ kind: "quote", text: quote.join("\n") });
      continue;
    }
    if (trimmed.includes("|") && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flush();
      const head = cells(trimmed);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item && !/^\s*\*\*/.test(line)) {
      flush();
      const ordered = item[1] !== undefined;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const next = LIST_ITEM.exec(lines[i]);
        if (next && (next[1] !== undefined) === ordered) items.push(next[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}

/** Bold, italics, inline code and links inside one block. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+?\*\*|__[^_]+?__)|(\*[^*\s][^*]*?\*|\b_[^_\s][^_]*?_\b)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let last = 0;
  let key = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const [whole] = match;
    if (match[1]) out.push(<code key={key++}>{whole.slice(1, -1)}</code>);
    else if (match[2]) out.push(<strong key={key++}>{renderInline(whole.slice(2, -2))}</strong>);
    else if (match[3]) out.push(<em key={key++}>{renderInline(whole.slice(1, -1))}</em>);
    else if (match[4]) {
      const label = whole.slice(1, whole.indexOf("]"));
      out.push(
        <a key={key++} href={match[5]} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    }
    last = match.index + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function lines(text: string) {
  return text.split("\n").map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {renderInline(line)}
    </Fragment>
  ));
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      {parseBlocks(children).map((block, i) => {
        switch (block.kind) {
          case "heading":
            return block.level <= 2 ? <h3 key={i}>{renderInline(block.text)}</h3> : <h4 key={i}>{renderInline(block.text)}</h4>;
          case "paragraph":
            return <p key={i}>{lines(block.text)}</p>;
          case "quote":
            return <blockquote key={i}>{lines(block.text)}</blockquote>;
          case "code":
            return (
              <pre key={i}>
                <code>{block.text}</code>
              </pre>
            );
          case "rule":
            return <hr key={i} />;
          case "list": {
            const items = block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>);
            return block.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case "table":
            return (
              <div className="md-table" key={i}>
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j}>{renderInline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, j) => (
                          <td key={j}>{renderInline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
