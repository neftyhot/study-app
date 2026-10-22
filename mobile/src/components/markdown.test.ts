import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown, parseBlocks } from "./markdown";

const html = (text: string) => renderToStaticMarkup(createElement(Markdown, null, text));

describe("tutor replies on the phone", () => {
  it("draws headings and bold instead of the raw marks", () => {
    const out = html("## Subtitle\n**Heading** and *this* with `code`.");
    expect(out).toContain("<h3>Subtitle</h3>");
    expect(out).toContain("<strong>Heading</strong>");
    expect(out).toContain("<em>this</em>");
    expect(out).toContain("<code>code</code>");
    expect(out).not.toContain("**");
    expect(out).not.toContain("##");
  });

  it("reads bullet and numbered lists", () => {
    expect(parseBlocks("Steps:\n1. Glycolysis\n2. Krebs\n\n- ATP\n* NADH")).toEqual([
      { kind: "paragraph", text: "Steps:" },
      { kind: "list", ordered: true, items: ["Glycolysis", "Krebs"] },
      { kind: "list", ordered: false, items: ["ATP", "NADH"] },
    ]);
  });

  it("reads a table and a code block", () => {
    const blocks = parseBlocks("| Drug | Class |\n|---|---|\n| Atenolol | Beta blocker |\n\n```\nx = 1\n```");
    expect(blocks[0]).toEqual({ kind: "table", head: ["Drug", "Class"], rows: [["Atenolol", "Beta blocker"]] });
    expect(blocks[1]).toEqual({ kind: "code", text: "x = 1" });
  });

  it("never passes HTML from the reply through", () => {
    const out = html('<img src="https://x.test/a.png"> <script>alert(1)</script>');
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
  });

  it("only links to web addresses", () => {
    expect(html("[site](https://example.com)")).toContain('href="https://example.com"');
    expect(html("[bad](javascript:alert(1))")).not.toContain("href");
  });
});
