/* The description renderer of the task view (T24, docs/07 "The task view").
 *
 * A description is markdown written by Claude (docs/05), so the parser is
 * checked on the shapes a composed description actually has — and on the one
 * thing that must never happen: text from an agent turning into markup or a
 * target the browser would execute.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown, parseInline, parseMarkdown, safeHref } from "../../src/app/markdown";

describe("parseMarkdown", () => {
  it("reads headings, paragraphs and both kinds of list", () => {
    const blocks = parseMarkdown(
      ["# Title", "", "A paragraph", "over two lines.", "", "- one", "- two", "", "1. first", "2. second"].join(
        "\n",
      ),
    );

    expect(blocks.map((block) => block.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
    ]);
    const [heading, paragraph, bullets, numbers] = blocks;
    expect(heading).toMatchObject({ type: "heading", level: 1 });
    // A soft wrap is one paragraph, the way markdown reads it.
    expect(paragraph).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "A paragraph over two lines." }],
    });
    expect(bullets).toMatchObject({ type: "list", ordered: false });
    expect(numbers).toMatchObject({ type: "list", ordered: true });
    expect((bullets as { items: unknown[] }).items).toHaveLength(2);
  });

  it("keeps a fenced block literal, markers and all", () => {
    const blocks = parseMarkdown(["```ts", "const a = 1; // *not* emphasis", "```"].join("\n"));
    expect(blocks).toEqual([
      { type: "code", language: "ts", text: "const a = 1; // *not* emphasis" },
    ]);
  });

  it("reads a block quote as one block", () => {
    expect(parseMarkdown("> one\n> two")).toEqual([
      { type: "quote", content: [{ type: "text", text: "one two" }] },
    ]);
  });

  it("gives an empty description no blocks at all", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n\n")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("reads code, bold, italic and links", () => {
    expect(parseInline("a `b` **c** *d* [e](https://example.com)")).toEqual([
      { type: "text", text: "a " },
      { type: "code", text: "b" },
      { type: "text", text: " " },
      { type: "strong", text: "c" },
      { type: "text", text: " " },
      { type: "em", text: "d" },
      { type: "text", text: " " },
      { type: "link", text: "e", href: "https://example.com" },
    ]);
  });

  it("leaves a lone marker as the character it is", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ type: "text", text: "2 * 3 = 6" }]);
  });

  it("does not read markers inside a code span", () => {
    expect(parseInline("`a *b* c`")).toEqual([{ type: "code", text: "a *b* c" }]);
  });
});

describe("safeHref", () => {
  it("takes http, https, a path and an anchor", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com");
    expect(safeHref("http://127.0.0.1:4400/api/health")).toBe("http://127.0.0.1:4400/api/health");
    expect(safeHref("/p/paim")).toBe("/p/paim");
    expect(safeHref("#section")).toBe("#section");
  });

  it("refuses a scheme the browser would execute", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(" javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,<script>")).toBeNull();
    expect(safeHref("")).toBeNull();
  });
});

describe("<Markdown>", () => {
  it("renders elements, not markup — a description cannot inject HTML", () => {
    render(<Markdown text={"## Heading\n\n<script>alert(1)</script> and `code`"} />);

    expect(screen.getByRole("heading", { name: "Heading" })).toBeTruthy();
    // The tag is text on the page, not a node in it.
    expect(document.querySelector("script")).toBeNull();
    expect(document.body.textContent).toContain("<script>alert(1)</script>");
    expect(document.querySelector("code")?.textContent).toBe("code");
  });

  it("renders a safe link and prints an unsafe one as words", () => {
    render(<Markdown text="[docs](/p/paim/docs) and [bad](javascript:alert(1))" />);

    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("href")).toBe("/p/paim/docs");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
    expect(document.body.textContent).toContain("bad");
  });

  it("renders a list as a list", () => {
    render(<Markdown text={"- one\n- two"} />);
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "one",
      "two",
    ]);
  });
});
