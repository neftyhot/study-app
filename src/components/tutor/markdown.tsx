"use client";

/**
 * Rendering what the tutor wrote.
 *
 * Markdown with GitHub tables and TeX maths, because lecture material is full
 * of both: a comparison is a table and a clearance equation is maths, and
 * either one rendered as literal syntax is harder to read than plain prose
 * would have been.
 */
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import "katex/dist/katex.min.css";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
          ),
          h1: ({ children }) => (
            <h3 className="mt-3 text-base font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-3 text-sm font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-3 text-sm font-semibold">{children}</h4>
          ),
          code: ({ className, children }) =>
            // A fenced block gets a language class; inline code does not, and
            // wrapping inline code in a <pre> would break the sentence.
            className ? (
              <code className={`${className} block`}>{children}</code>
            ) : (
              <code className="bg-muted rounded px-1 py-0.5 text-[0.85em]">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="bg-muted my-2 overflow-x-auto rounded-md p-3 text-xs">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border p-1.5 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border p-1.5">{children}</td>,
          a: ({ children, href }) => (
            <a href={href} className="underline underline-offset-2">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
