import { describe, expect, it } from "vitest";
import { matchPath, normalizePath } from "../../src/app/router";

describe("normalizePath", () => {
  it("keeps the root as a single slash", () => {
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("drops a trailing slash so one screen has one spelling", () => {
    expect(normalizePath("/p/paim/")).toBe("/p/paim");
    expect(normalizePath("/p/paim")).toBe("/p/paim");
  });
});

describe("matchPath", () => {
  it("matches the root only at the root", () => {
    expect(matchPath("/", "/")).toEqual({});
    expect(matchPath("/", "/p/paim")).toBeNull();
  });

  it("captures a named segment", () => {
    expect(matchPath("/p/:project", "/p/paim")).toEqual({ project: "paim" });
  });

  it("decodes a captured segment", () => {
    expect(matchPath("/p/:project", "/p/my%20project")).toEqual({ project: "my project" });
  });

  it("does not match a longer or shorter path", () => {
    expect(matchPath("/p/:project", "/p/paim/t/FEAT-1")).toBeNull();
    expect(matchPath("/p/:project", "/p")).toBeNull();
  });

  it("does not accept an empty segment as a value", () => {
    expect(matchPath("/p/:project", "/p/")).toBeNull();
  });
});
