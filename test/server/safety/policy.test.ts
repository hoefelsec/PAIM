import { describe, expect, it } from "vitest";

import { decide, matchesAny, matchesEntry, normalizeCommand } from "../../../src/server/safety/policy.js";
import { seedAskList } from "../../../src/server/safety/askListSeeds.js";
import type { SafetyPolicy } from "../../../src/shared/types.js";
import { PROJECT_TYPES } from "../../../src/shared/types.js";

function bash(command: string) {
  return { kind: "bash" as const, command };
}
function file(path: string) {
  return { kind: "file" as const, path };
}

describe("normalizeCommand", () => {
  it("trims the ends and collapses repeated interior whitespace", () => {
    expect(normalizeCommand("  git   push  ")).toBe("git push");
  });
});

describe("matchesEntry — the pattern matcher table", () => {
  // >= 15 cases, including non-matches, per specs/08 "Tests".
  const cases: Array<{ pattern: string; op: ReturnType<typeof bash> | ReturnType<typeof file>; expected: boolean; label: string }> = [
    // docs/10 §4's own worked examples.
    { label: "git push* matches git push --force", pattern: "git push*", op: bash("git push --force"), expected: true },
    {
      label: "git push* matches a double-spaced command after normalization",
      pattern: "git push*",
      op: bash("git  push  --force"),
      expected: true,
    },
    { label: "*.env matches a write to prod.env", pattern: "*.env", op: file("prod.env"), expected: true },
    { label: "*.env matches a nested path ending in .env", pattern: "*.env", op: file("config/prod.env"), expected: true },
    // Non-matches.
    { label: "git push* does not match git commit", pattern: "git push*", op: bash("git commit -m x"), expected: false },
    { label: "*.env does not match .env.example (extra suffix)", pattern: "*.env", op: file(".env.example"), expected: false },
    { label: "*.env does not match a .txt file", pattern: "*.env", op: file("prod.txt"), expected: false },
    // Case sensitivity (specs/08: "Case-sensitive").
    { label: "case-sensitive: GIT PUSH does not match git push*", pattern: "git push*", op: bash("GIT PUSH"), expected: false },
    // Trailing/leading whitespace normalization on bash commands only.
    { label: "leading/trailing spaces are trimmed before matching", pattern: "git push*", op: bash("   git push --force   "), expected: true },
    // A pattern with no wildcard is an exact match.
    { label: "an exact pattern matches only the identical command", pattern: "npm publish", op: bash("npm publish"), expected: true },
    { label: "an exact pattern does not match a longer command", pattern: "npm publish", op: bash("npm publish --tag next"), expected: false },
    // Wildcards in the middle.
    { label: "rm * matches rm -rf ./build", pattern: "rm *", op: bash("rm -rf ./build"), expected: true },
    { label: "docker * matches docker compose up", pattern: "docker *", op: bash("docker compose up"), expected: true },
    { label: "curl * matches a curl with flags", pattern: "curl *", op: bash("curl -sL https://example.com"), expected: true },
    // File-op paths are matched as-is (no whitespace normalization applies).
    { label: "a glob directory pattern matches a file two levels deep", pattern: "secrets/**", op: file("secrets/prod/db.env"), expected: true },
    { label: "a glob directory pattern does not match a sibling directory", pattern: "secrets/**", op: file("config/db.env"), expected: false },
    // The matcher only looks at the string, not the operation kind: a
    // bash-shaped pattern matches a file-op path carrying the same text.
    { label: "a bash-shaped pattern matches a file-op path with the same literal text", pattern: "git push*", op: file("git push --force"), expected: true },
    // Dotfile / dot-segment targets (dot: true): the highest-value deny
    // targets must not slip past the matcher because of a leading `.`.
    { label: "rm -rf /* matches rm -rf /.ssh (dotfile segment after /)", pattern: "rm -rf /*", op: bash("rm -rf /.ssh"), expected: true },
    { label: "rm * matches rm -rf ~/.ssh (dotfile segment after /)", pattern: "rm *", op: bash("rm -rf ~/.ssh"), expected: true },
    { label: "*.env matches a bare .env file (leading dot)", pattern: "*.env", op: file(".env"), expected: true },
    { label: "curl * matches a URL path containing /.env", pattern: "curl *", op: bash("curl https://e.com/.env"), expected: true },
  ];

  it.each(cases)("$label", ({ pattern, op, expected }) => {
    expect(matchesEntry(pattern, op)).toBe(expected);
  });

  it("matchesAny is true when any entry in the list matches", () => {
    expect(matchesAny(["git commit*", "git push*"], bash("git push --force"))).toBe(true);
  });

  it("matchesAny is false when no entry matches", () => {
    expect(matchesAny(["git commit*", "npm publish*"], bash("git push --force"))).toBe(false);
  });

  it("matchesAny on an empty list is always false", () => {
    expect(matchesAny([], bash("anything"))).toBe(false);
  });
});

describe("decide — the mode x membership decision matrix", () => {
  function policy(overrides: Partial<SafetyPolicy> = {}): SafetyPolicy {
    return { denyList: [], mode: "ask_all", askList: [], ...overrides };
  }

  it("deny beats allow_all: a deny-listed command is refused even when the mode allows everything", () => {
    const p = policy({ denyList: ["rm -rf /*"], mode: "allow_all" });
    expect(decide(bash("rm -rf /*"), p)).toBe("deny");
  });

  it("deny beats ask_all", () => {
    const p = policy({ denyList: ["git push --force*"], mode: "ask_all" });
    expect(decide(bash("git push --force"), p)).toBe("deny");
  });

  it("deny beats ask_listed regardless of ask-list membership", () => {
    const p = policy({ denyList: ["*.env"], mode: "ask_listed", askList: [] });
    expect(decide(file("prod.env"), p)).toBe("deny");
  });

  it("does not deny a file-op path just because it contains deny-listed text as a substring", () => {
    const p = policy({ denyList: ["rm -rf /*"], mode: "allow_all" });
    expect(decide(file("somewhere/rm -rf /*"), p)).toBe("allow");
  });

  it("deny 'rm -rf /*' catches the dotfile target 'rm -rf /.ssh' that a dot:false matcher would miss", () => {
    const p = policy({ denyList: ["rm -rf /*"], mode: "allow_all" });
    expect(decide(bash("rm -rf /.ssh"), p)).toBe("deny");
  });

  it("ask_listed 'rm *' catches the dotfile target 'rm -rf ~/.ssh'", () => {
    const p = policy({ mode: "ask_listed", askList: ["rm *"] });
    expect(decide(bash("rm -rf ~/.ssh"), p)).toBe("ask");
  });

  it("ask_listed '*.env' catches a bare '.env' file", () => {
    const p = policy({ mode: "ask_listed", askList: ["*.env"] });
    expect(decide(file(".env"), p)).toBe("ask");
  });

  it("ask_listed 'curl *' catches a URL whose path contains '/.env'", () => {
    const p = policy({ mode: "ask_listed", askList: ["curl *"] });
    expect(decide(bash("curl https://e.com/.env"), p)).toBe("ask");
  });

  it("allow_all: a non-denied operation always allows", () => {
    const p = policy({ mode: "allow_all" });
    expect(decide(bash("git push"), p)).toBe("allow");
    expect(decide(file("prod.env"), p)).toBe("allow");
  });

  it("ask_all: every non-denied operation asks, including reads", () => {
    const p = policy({ mode: "ask_all" });
    expect(decide(bash("cat file.txt"), p)).toBe("ask");
    expect(decide(file("readme.md"), p)).toBe("ask");
  });

  it("ask_listed: a listed operation asks", () => {
    const p = policy({ mode: "ask_listed", askList: ["git push*"] });
    expect(decide(bash("git push"), p)).toBe("ask");
  });

  it("ask_listed: an unlisted operation allows", () => {
    const p = policy({ mode: "ask_listed", askList: ["git push*"] });
    expect(decide(bash("git status"), p)).toBe("allow");
  });

  it("ask_listed with an empty ask list allows everything not denied", () => {
    const p = policy({ mode: "ask_listed", askList: [] });
    expect(decide(bash("anything at all"), p)).toBe("allow");
  });

  it("per-task override replaces the mode: ask_all project + allow_all override allows a non-denied op", () => {
    const p = policy({ mode: "ask_all" });
    expect(decide(bash("git status"), p, "allow_all")).toBe("allow");
  });

  it("per-task override cannot widen past the deny list", () => {
    const p = policy({ denyList: ["rm -rf /*"], mode: "ask_all" });
    expect(decide(bash("rm -rf /*"), p, "allow_all")).toBe("deny");
  });

  it("per-task override to ask_all forces a prompt even when the project allows everything", () => {
    const p = policy({ mode: "allow_all" });
    expect(decide(bash("git push"), p, "ask_all")).toBe("ask");
  });

  it("a null override falls back to the project's mode", () => {
    const p = policy({ mode: "allow_all" });
    expect(decide(bash("git push"), p, null)).toBe("allow");
  });

  it("an undefined override falls back to the project's mode", () => {
    const p = policy({ mode: "ask_listed", askList: ["git push*"] });
    expect(decide(bash("git push"), p, undefined)).toBe("ask");
  });

  it("ask_listed override still uses the project's askList, not a task-supplied one", () => {
    // decide() has no parameter for a task ask list at all — the override
    // can only ever be a mode (docs/10 §5: "The deny list is not part of
    // the override" and, by the same reasoning, so is the ask list).
    const p = policy({ mode: "ask_all", askList: ["npm publish*"] });
    expect(decide(bash("npm publish"), p, "ask_listed")).toBe("ask");
    expect(decide(bash("git push"), p, "ask_listed")).toBe("allow");
  });
});

describe("seedAskList — default ask lists per project type", () => {
  it("returns a non-empty list for every project type", () => {
    for (const type of PROJECT_TYPES) {
      expect(seedAskList(type).length).toBeGreaterThan(0);
    }
  });

  it("includes ecosystem-specific entries for node", () => {
    expect(seedAskList("node")).toContain("npm publish*");
  });

  it("includes ecosystem-specific entries for python", () => {
    expect(seedAskList("python")).toContain("pip install*");
  });

  it("includes ecosystem-specific entries for go", () => {
    expect(seedAskList("go")).toContain("go install*");
  });

  it("includes ecosystem-specific entries for rust", () => {
    expect(seedAskList("rust")).toContain("cargo publish*");
  });

  it("returns a fresh array each call (callers can safely mutate their copy)", () => {
    const a = seedAskList("generic");
    const b = seedAskList("generic");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
