/* The little markdown the task view reads (docs/07 "The task view").
 *
 * A task's description is markdown: Claude writes it (docs/05) and the
 * overview shows it. The dependency list of docs/14-scope-and-operations.md
 * names no markdown library, so this is the whole of it — the subset the
 * composer actually produces: headings, paragraphs, bullet and numbered
 * lists, fenced code, block quotes, and inline `code`, **bold**, *italic*
 * and links.
 *
 * The parser returns a model and the renderer turns that model into React
 * elements. Nothing is ever handed to `dangerouslySetInnerHTML`, so a
 * description written by an agent cannot put markup — or a script — on the
 * screen. A link is only a link when its target is one the interface trusts
 * (see {@link safeHref}); anything else stays text.
 */

import type { ReactNode } from "react";

/* ── the model ──────────────────────────────────────────────────────────── */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; content: Inline[] }
  | { type: "paragraph"; content: Inline[] }
  | { type: "quote"; content: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "code"; text: string; language: string };

/* ── inline ─────────────────────────────────────────────────────────────── */

/**
 * `code` first: everything inside a span of backticks is literal, so a `*` in
 * a code span is not emphasis. The rest are matched in one pass, left to
 * right, and an unmatched marker stays the character it is.
 */
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]*\]\([^)\s]*\))/;

/**
 * A target the interface will follow. A description arrives from an agent, so
 * `javascript:` — and every other scheme the browser would execute — is not a
 * link here; the text stays on screen and the target does not.
 */
export function safeHref(href: string): string | null {
  const target = href.trim();
  if (target === "") return null;
  if (/^https?:\/\//i.test(target)) return target;
  // Same-document and same-origin references: a docs path, an anchor.
  if (target.startsWith("/") || target.startsWith("#")) return target;
  return null;
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;

  const push = (node: Inline) => {
    if (node.type === "text" && node.text === "") return;
    out.push(node);
  };

  while (rest !== "") {
    const match = INLINE.exec(rest);
    if (!match) {
      push({ type: "text", text: rest });
      break;
    }
    push({ type: "text", text: rest.slice(0, match.index) });
    const token = match[0];
    rest = rest.slice(match.index + token.length);

    if (token.startsWith("`")) {
      push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      push({ type: "strong", text: token.slice(2, -2) });
    } else if (token.startsWith("*")) {
      push({ type: "em", text: token.slice(1, -1) });
    } else {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = safeHref(token.slice(split + 2, -1));
      if (href === null) push({ type: "text", text: label === "" ? token : label });
      else push({ type: "link", text: label === "" ? href : label, href });
    }
  }

  return out;
}

/* ── blocks ─────────────────────────────────────────────────────────────── */

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```(\S*)\s*$/;
const QUOTE = /^\s*>\s?(.*)$/;

/** Markdown text as a list of blocks. Unknown syntax degrades to paragraphs. */
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", content: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    if (line.trim() === "") {
      flush();
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      // An unclosed fence runs to the end of the text rather than swallowing
      // the rest as a paragraph: what the author typed is still readable.
      while (i < lines.length && !FENCE.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      blocks.push({ type: "code", text: body.join("\n"), language: fence[1] ?? "" });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        content: parseInline(heading[2] ?? ""),
      });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      flush();
      const body = [quote[1] ?? ""];
      while (i + 1 < lines.length && QUOTE.test(lines[i + 1] ?? "")) {
        i++;
        body.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
      }
      blocks.push({ type: "quote", content: parseInline(body.join(" ")) });
      continue;
    }

    const ordered = NUMBERED.test(line);
    const item = ordered ? NUMBERED.exec(line) : BULLET.exec(line);
    if (item) {
      flush();
      const items: Inline[][] = [parseInline(item[1] ?? "")];
      const same = (candidate: string) =>
        ordered ? NUMBERED.test(candidate) : BULLET.test(candidate) && !NUMBERED.test(candidate);
      while (i + 1 < lines.length && same(lines[i + 1] ?? "")) {
        i++;
        const next = ordered ? NUMBERED.exec(lines[i] ?? "") : BULLET.exec(lines[i] ?? "");
        items.push(parseInline(next?.[1] ?? ""));
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    paragraph.push(line.trim());
  }

  flush();
  return blocks;
}

/* ── the rendering ──────────────────────────────────────────────────────── */

const CODE = "rounded-[4px] bg-raised px-1 py-px font-mono text-id text-tx-primary";

function InlineRun({ nodes }: { nodes: readonly Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "code":
            return (
              <code key={index} className={CODE}>
                {node.text}
              </code>
            );
          case "strong":
            return (
              <strong key={index} className="font-semibold text-tx-primary">
                {node.text}
              </strong>
            );
          case "em":
            return <em key={index}>{node.text}</em>;
          case "link":
            return (
              <a
                key={index}
                href={node.href}
                rel="noreferrer"
                className="text-accent underline decoration-accent/40 underline-offset-2
                           transition-colors duration-(--dur-hover-out)
                           hover:text-accent-hover hover:duration-(--dur-hover-in)"
              >
                {node.text}
              </a>
            );
          default:
            return <span key={index}>{node.text}</span>;
        }
      })}
    </>
  );
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: "text-task text-tx-primary",
  2: "text-row font-semibold text-tx-primary",
  3: "text-prop font-semibold text-tx-secondary",
};

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = (["h2", "h3", "h4"] as const)[block.level - 1] ?? "h4";
      return (
        <Tag key={index} className={`mt-1 ${HEADING_CLASS[block.level]}`}>
          <InlineRun nodes={block.content} />
        </Tag>
      );
    }
    case "code":
      return (
        <pre
          key={index}
          data-language={block.language === "" ? undefined : block.language}
          className="overflow-x-auto rounded-ctl border border-bd-subtle bg-base p-3
                     font-mono text-id text-tx-secondary"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={index}
          className="border-l-2 border-bd-strong pl-3 text-prop text-tx-secondary"
        >
          <InlineRun nodes={block.content} />
        </blockquote>
      );
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={index}
          className={`ml-5 flex list-outside flex-col gap-1 ${
            block.ordered ? "list-decimal" : "list-disc"
          }`}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              <InlineRun nodes={item} />
            </li>
          ))}
        </Tag>
      );
    }
    default:
      return (
        <p key={index}>
          <InlineRun nodes={block.content} />
        </p>
      );
  }
}

/** The description of a task, as markdown. Empty text renders nothing. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) return null;
  return (
    <div
      data-slot="markdown"
      className={`flex flex-col gap-3 text-row leading-[1.65] text-tx-secondary ${className ?? ""}`}
    >
      {blocks.map(renderBlock)}
    </div>
  );
}
