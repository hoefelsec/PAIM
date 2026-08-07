import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { confinePath } from "../../../src/server/safety/confine.js";

describe("confinePath", () => {
  let dir: string;
  let root: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "paim-confine-")));
    root = join(dir, "workspace");
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("allows a plain relative path inside the root", () => {
    writeFileSync(join(root, "file.txt"), "hi");
    const result = confinePath(root, "file.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(join(root, "file.txt"));
  });

  it("allows a nested relative path that does not yet exist", () => {
    const result = confinePath(root, join("sub", "dir", "new-file.txt"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(join(root, "sub", "dir", "new-file.txt"));
  });

  it("allows the root itself", () => {
    const result = confinePath(root, ".");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(root);
  });

  it("refuses a `..` escape", () => {
    const result = confinePath(root, "../outside.txt");
    expect(result).toEqual({ ok: false, reason: "escape" });
  });

  it("refuses a `..` escape buried in a longer relative path", () => {
    const result = confinePath(root, join("a", "..", "..", "outside.txt"));
    expect(result).toEqual({ ok: false, reason: "escape" });
  });

  it("refuses an absolute path outside the root", () => {
    const outside = join(dir, "elsewhere.txt");
    const result = confinePath(root, outside);
    expect(result).toEqual({ ok: false, reason: "escape" });
  });

  it("allows an absolute path that is inside the root", () => {
    const inside = join(root, "file.txt");
    const result = confinePath(root, inside);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(inside);
  });

  it("does not confuse a sibling root that shares a string prefix (/a/b vs /a/bb)", () => {
    const a = join(dir, "a");
    const b = join(a, "b");
    const bb = join(a, "bb");
    mkdirSync(b, { recursive: true });
    mkdirSync(bb, { recursive: true });
    writeFileSync(join(bb, "secret.txt"), "nope");

    // Candidate resolves (via a literal `..` from inside `b`) into `bb`,
    // a sibling that merely shares a prefix with `b` — must be refused.
    const result = confinePath(b, join("..", "bb", "secret.txt"));
    expect(result).toEqual({ ok: false, reason: "escape" });

    // But addressing bb directly, using bb as root, is fine.
    const ok = confinePath(bb, "secret.txt");
    expect(ok.ok).toBe(true);
  });

  it("refuses a symlink that points outside the root", () => {
    const outsideTarget = join(dir, "outside");
    mkdirSync(outsideTarget, { recursive: true });
    writeFileSync(join(outsideTarget, "secret.txt"), "nope");

    const link = join(root, "escape-link");
    symlinkSync(outsideTarget, link);

    const result = confinePath(root, join("escape-link", "secret.txt"));
    expect(result).toEqual({ ok: false, reason: "escape" });
  });

  it("refuses a chain of symlinks that eventually leaves the root", () => {
    const outsideTarget = join(dir, "outside");
    mkdirSync(outsideTarget, { recursive: true });

    const linkA = join(root, "link-a");
    const linkB = join(root, "link-b");
    // link-a -> link-b -> outside (a chain of two hops before leaving the root).
    symlinkSync(outsideTarget, linkB);
    symlinkSync(linkB, linkA);

    const result = confinePath(root, "link-a");
    expect(result).toEqual({ ok: false, reason: "escape" });
  });

  it("allows a chain of symlinks that stays inside the root", () => {
    const real = join(root, "real-dir");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "file.txt"), "hi");

    const linkA = join(root, "link-a");
    const linkB = join(root, "link-b");
    // link-a -> link-b -> real-dir (both hops stay inside the root).
    symlinkSync(real, linkB);
    symlinkSync(linkB, linkA);

    const result = confinePath(root, join("link-a", "file.txt"));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(join(realpathSync(real), "file.txt"));
  });

  it("resolves a symlinked root itself before checking containment", () => {
    const real = join(dir, "real-workspace");
    mkdirSync(real, { recursive: true });
    writeFileSync(join(real, "file.txt"), "hi");

    const linkedRoot = join(dir, "linked-workspace");
    symlinkSync(real, linkedRoot);

    const result = confinePath(linkedRoot, "file.txt");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.path).toBe(join(realpathSync(real), "file.txt"));
  });

  it("property-style: lexical stack simulation predicts containment for many segment sequences", () => {
    // Every sequence of "a"/"b" (descend into a named dir) and ".." (ascend)
    // segments, up to length 5, walked from the root. The expectation is
    // computed by simulating lexical path resolution with an explicit stack
    // (the same algorithm path.resolve/path.relative implement): "a"/"b"
    // pushes a segment, ".." pops one, or — once the stack is empty —
    // ascends *above* the root, which can never be cancelled back to "inside"
    // by a later descend (the popped root segment's name is lost).
    const alphabet = ["a", "b", ".."] as const;
    const maxLen = 5;

    const sequences: string[][] = [[]];
    for (let len = 1; len <= maxLen; len++) {
      const next: string[][] = [];
      for (const seq of sequences.filter((s) => s.length === len - 1)) {
        for (const seg of alphabet) next.push([...seq, seg]);
      }
      sequences.push(...next);
    }

    function expectedInside(seq: string[]): boolean {
      // Once a ".." pops past an empty stack, the walk has left the root for
      // a directory the alphabet ("a"/"b") never names again — there is no
      // way back to "inside" without spelling the root's own name, which
      // isn't in the alphabet. So escaping is a one-way, sticky state.
      const stack: string[] = [];
      let escaped = false;
      for (const seg of seq) {
        if (escaped) continue;
        if (seg === "..") {
          if (stack.length > 0) stack.pop();
          else escaped = true;
        } else {
          stack.push(seg);
        }
      }
      return !escaped;
    }

    for (const seq of sequences) {
      if (seq.length === 0) continue;
      const candidate = seq.join(sep);
      const result = confinePath(root, candidate);
      expect(result.ok).toBe(expectedInside(seq));
    }
  });
});
