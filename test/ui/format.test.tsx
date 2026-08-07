import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_GLYPH,
  progressPercent,
  projectGlyph,
  projectTone,
  relativeTime,
} from "../../src/app/format";
import { IDENTITY_TONES, toneVar } from "../../src/ui/vocabulary";

const NOW = Date.parse("2026-01-20T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("relativeTime", () => {
  it("reads minutes, hours and days", () => {
    expect(relativeTime(ago(30_000), NOW)).toBe("just now");
    expect(relativeTime(ago(18 * 60_000), NOW)).toBe("18m ago");
    expect(relativeTime(ago(2 * 3_600_000), NOW)).toBe("2h ago");
    expect(relativeTime(ago(30 * 3_600_000), NOW)).toBe("yesterday");
    expect(relativeTime(ago(3 * 86_400_000), NOW)).toBe("3d ago");
  });

  it("falls back to the date once a count of days stops helping", () => {
    expect(relativeTime(ago(40 * 86_400_000), NOW)).toBe("2025-12-11");
  });

  it("says nothing about a value it cannot read", () => {
    expect(relativeTime("not a date", NOW)).toBe("");
  });
});

describe("progressPercent", () => {
  it("rounds done over total", () => {
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(11, 28)).toBe(39);
  });

  it("is zero, not NaN, for a project with no tasks", () => {
    expect(progressPercent(0, 0)).toBe(0);
  });
});

describe("project identity", () => {
  it("uses the project's tone when it has one", () => {
    expect(projectTone({ color: "steel" })).toBe("steel");
  });

  it("falls back to the neutral tone", () => {
    expect(projectTone({ color: null })).toBe("grey");
  });

  it("names every tone variable in full, in the source", () => {
    // Tailwind emits a theme variable only when its name appears literally in
    // the source it scans, so a name assembled at run time
    // (`--color-id-${tone}`) never reaches the stylesheet and the tone renders
    // as no colour at all.
    // jsdom gives `import.meta.url` an http origin, so this reads from the
    // project root instead.
    const source = readFileSync(join(process.cwd(), "src/ui/vocabulary.ts"), "utf-8");
    for (const tone of IDENTITY_TONES) {
      expect(toneVar(tone)).toBe(`var(--color-id-${tone})`);
      expect(source).toContain(`var(--color-id-${tone})`);
    }
  });

  it("supplies a glyph when the project has none", () => {
    expect(projectGlyph({ icon: "⌂" })).toBe("⌂");
    expect(projectGlyph({ icon: null })).toBe(DEFAULT_PROJECT_GLYPH);
    expect(projectGlyph({ icon: "  " })).toBe(DEFAULT_PROJECT_GLYPH);
  });
});
