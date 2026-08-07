import { describe, expect, it } from "vitest";
import {
  MAX_SLUG_LENGTH,
  isValidSlug,
  slugify,
  uniqueSlug,
} from "../../../src/server/projects/slug.js";

describe("slugify", () => {
  it.each([
    ["PAIM", "paim"],
    ["Project AI Manager", "project-ai-manager"],
    ["  spaced   out  ", "spaced-out"],
    ["Ünïcödé Nâme", "unicode-name"],
    ["symbols !@#$ here", "symbols-here"],
    ["trailing---", "trailing"],
    ["already-a-slug", "already-a-slug"],
    ["v1.2.3 release", "v1-2-3-release"],
  ])("derives %j into %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("falls back to a usable slug when nothing survives", () => {
    expect(slugify("***")).toBe("project");
  });

  it("always produces a URL-safe slug within the length limit", () => {
    const long = "A very long project name ".repeat(20);
    const slug = slugify(long);

    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(isValidSlug(slug)).toBe(true);
  });
});

describe("isValidSlug", () => {
  it.each(["paim", "a", "one-two-three", "v1-2"])("accepts %j", (slug) => {
    expect(isValidSlug(slug)).toBe(true);
  });

  it.each(["Paim", "with space", "-leading", "trailing-", "double--hyphen", "under_score", ""])(
    "rejects %j",
    (slug) => {
      expect(isValidSlug(slug)).toBe(false);
    },
  );
});

describe("uniqueSlug", () => {
  it("returns the base when it is free", () => {
    expect(uniqueSlug("paim", () => false)).toBe("paim");
  });

  it("suffixes until a free slug is found", () => {
    const taken = new Set(["paim", "paim-2", "paim-3"]);
    expect(uniqueSlug("paim", (s) => taken.has(s))).toBe("paim-4");
  });

  it("keeps a suffixed slug inside the length limit and URL-safe", () => {
    const base = slugify("x".repeat(MAX_SLUG_LENGTH + 10));
    const slug = uniqueSlug(base, (s) => s === base);

    expect(slug).not.toBe(base);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(isValidSlug(slug)).toBe(true);
  });
});
