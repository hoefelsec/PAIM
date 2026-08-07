import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearVersionCache, readProjectVersion } from "../../../src/server/projects/version.js";
import type { Project } from "../../../src/shared/types.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-version-"));
  clearVersionCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function project(overrides: Partial<Pick<Project, "type" | "workspacePath">>) {
  return { type: "node" as const, workspacePath: dir, ...overrides };
}

const realDeps = {
  statMs: (p: string) => statSync(p).mtimeMs,
  readFile: (p: string) => readFileSync(p, "utf8"),
};

/** Bumps a file's mtime forward, independent of filesystem timestamp granularity. */
function bumpMtime(path: string, aheadMs: number): void {
  const future = new Date(Date.now() + aheadMs);
  utimesSync(path, future, future);
}

describe("readProjectVersion", () => {
  it("reads the version from package.json for a node project", () => {
    const file = join(dir, "package.json");
    writeFileSync(file, JSON.stringify({ name: "x", version: "1.2.3" }));

    expect(readProjectVersion(project({ type: "node" }))).toBe("1.2.3");
  });

  it("reads the version from pyproject.toml for a python project", () => {
    writeFileSync(join(dir, "pyproject.toml"), '[project]\nname = "x"\nversion = "0.4.0"\n');

    expect(readProjectVersion(project({ type: "python" }))).toBe("0.4.0");
  });

  it("reads the version from Cargo.toml for a rust project", () => {
    writeFileSync(join(dir, "Cargo.toml"), '[package]\nname = "x"\nversion = "2.0.0"\n');

    expect(readProjectVersion(project({ type: "rust" }))).toBe("2.0.0");
  });

  it("returns null for a go project (go.mod carries no app version)", () => {
    writeFileSync(join(dir, "go.mod"), "module example.com/x\n\ngo 1.21\n");

    expect(readProjectVersion(project({ type: "go" }))).toBeNull();
  });

  it("returns null when the source file is absent", () => {
    expect(readProjectVersion(project({ type: "node" }))).toBeNull();
  });

  it("returns null when there is no workspacePath", () => {
    expect(readProjectVersion(project({ workspacePath: null }))).toBeNull();
  });

  it("returns null when package.json is not valid JSON", () => {
    writeFileSync(join(dir, "package.json"), "not json");

    expect(readProjectVersion(project({ type: "node" }))).toBeNull();
  });

  it("uses git describe for a generic project", () => {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");

    const gitDescribe = vi.fn().mockReturnValue("v1.0.0-3-gabc1234");
    const value = readProjectVersion(project({ type: "generic" }), { ...realDeps, gitDescribe });

    expect(value).toBe("v1.0.0-3-gabc1234");
    expect(gitDescribe).toHaveBeenCalledWith(dir);
  });

  it("returns null for a generic project outside a git repo", () => {
    expect(readProjectVersion(project({ type: "generic" }))).toBeNull();
  });

  describe("mtime cache", () => {
    it("re-reads only once per mtime and reflects a bumped mtime without restart", () => {
      const file = join(dir, "package.json");
      writeFileSync(file, JSON.stringify({ version: "1.0.0" }));

      const readFile = vi.fn((p: string) => readFileSync(p, "utf8"));
      const deps = { statMs: realDeps.statMs, readFile, gitDescribe: vi.fn() };
      const p = project({ type: "node" });

      // Multiple reads at the same mtime hit the cache: the underlying read
      // runs at most once per mtime.
      expect(readProjectVersion(p, deps)).toBe("1.0.0");
      expect(readProjectVersion(p, deps)).toBe("1.0.0");
      expect(readProjectVersion(p, deps)).toBe("1.0.0");
      expect(readFile).toHaveBeenCalledTimes(1);

      // Bump the mtime and change the content: the cached value updates
      // without any restart of the process.
      writeFileSync(file, JSON.stringify({ version: "2.0.0" }));
      bumpMtime(file, 5000);

      expect(readProjectVersion(p, deps)).toBe("2.0.0");
      expect(readFile).toHaveBeenCalledTimes(2);

      // Reading again at the new mtime still hits the cache.
      expect(readProjectVersion(p, deps)).toBe("2.0.0");
      expect(readFile).toHaveBeenCalledTimes(2);
    });

    it("runs git describe at most once per mtime for generic projects", () => {
      mkdirSync(join(dir, ".git"));
      writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");

      const gitDescribe = vi.fn().mockReturnValue("v1.0.0");
      const deps = { ...realDeps, gitDescribe };
      const p = project({ type: "generic" });

      readProjectVersion(p, deps);
      readProjectVersion(p, deps);
      expect(gitDescribe).toHaveBeenCalledTimes(1);

      bumpMtime(join(dir, ".git", "HEAD"), 5000);
      gitDescribe.mockReturnValue("v1.0.1");

      expect(readProjectVersion(p, deps)).toBe("v1.0.1");
      expect(gitDescribe).toHaveBeenCalledTimes(2);
    });
  });
});
