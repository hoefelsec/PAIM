/* The glyph vocabulary the table draws (docs/13 "Icons and shapes").
 *
 * Colour marks state, shape marks value — so every assertion here is about
 * shape: how many bars are lit, how many dots are discs rather than rings,
 * and whether two type silhouettes can be told apart with the colour gone.
 */

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PriorityIcon, SizeIcon, StatusRing, TypeIcon } from "../../src/ui/shapes";
import {
  PRIORITIES,
  PRIORITY_BARS,
  PRIORITY_LABEL,
  SIZE_FILLED,
  SIZE_LABEL,
  STATUS_LABEL,
  TASK_TYPES,
  TYPE_LABEL,
  type Size,
} from "../../src/ui/vocabulary";

const UNLIT = "var(--color-bd-subtle)";

describe("priority glyph", () => {
  it("grows in bar height: one lit bar per level, on a fixed four-slot base", () => {
    for (const priority of PRIORITIES) {
      const { container, unmount } = render(<PriorityIcon priority={priority} />);
      const bars = [...container.querySelectorAll("rect")];

      // Four slots always render, so the column keeps one width.
      expect(bars).toHaveLength(4);
      const lit = bars.filter((bar) => bar.getAttribute("fill") !== UNLIT);
      expect(lit).toHaveLength(PRIORITY_BARS[priority]);

      // Height is the scale: each slot is taller than the one before it.
      const heights = bars.map((bar) => Number(bar.getAttribute("height")));
      for (let i = 1; i < heights.length; i++) {
        expect(heights[i]!).toBeGreaterThan(heights[i - 1]!);
      }
      unmount();
    }
  });

  it("separates all five values by shape alone", () => {
    const pictures = PRIORITIES.map((priority) => {
      const { container, unmount } = render(<PriorityIcon priority={priority} />);
      const html = container.innerHTML;
      unmount();
      return html;
    });
    expect(new Set(pictures).size).toBe(PRIORITIES.length);
  });

  it("names the value for the pointer", () => {
    const { getByRole } = render(<PriorityIcon priority="urgent" />);
    const glyph = getByRole("img", { name: PRIORITY_LABEL.urgent });
    expect(glyph.querySelector("title")?.textContent).toBe(PRIORITY_LABEL.urgent);
  });
});

describe("size glyph", () => {
  it("fills in dot count: XS–XL are 1–5 discs of 5, the rest rings", () => {
    for (const size of ["XS", "S", "M", "L", "XL"] as const) {
      const { container, unmount } = render(<SizeIcon size={size} />);
      const dots = [...container.querySelectorAll("circle")];

      expect(dots).toHaveLength(5);
      const discs = dots.filter((dot) => dot.getAttribute("fill") !== "none");
      const rings = dots.filter((dot) => dot.getAttribute("fill") === "none");
      expect(discs).toHaveLength(SIZE_FILLED[size]);
      expect(rings).toHaveLength(5 - SIZE_FILLED[size]);
      // A ring is a stroke, not a dim fill: at 5px a fill difference alone
      // is unreadable.
      for (const ring of rings) expect(ring.getAttribute("stroke")).toBeTruthy();
      unmount();
    }
  });

  it("gives Epic its own mark instead of a point on the scale", () => {
    const { container, getByRole } = render(<SizeIcon size="Epic" />);
    expect(getByRole("img", { name: SIZE_LABEL.Epic })).toBeTruthy();
    expect(container.querySelectorAll("circle")).toHaveLength(0);
    expect(container.querySelector("rect")).toBeTruthy();
  });

  it("names the value for the pointer", () => {
    for (const size of Object.keys(SIZE_LABEL) as Size[]) {
      const { container, unmount } = render(<SizeIcon size={size} />);
      expect(container.querySelector("title")?.textContent).toBe(SIZE_LABEL[size]);
      unmount();
    }
  });
});

describe("type glyph", () => {
  it("draws a different silhouette for every option of the pool", () => {
    const silhouettes = TASK_TYPES.map((type) => {
      const { container, unmount } = render(<TypeIcon type={type} />);
      const shape = container.querySelector("svg")!.innerHTML.replace(/<title>.*<\/title>/, "");
      unmount();
      return shape;
    });
    expect(new Set(silhouettes).size).toBe(TASK_TYPES.length);
  });

  it("names the value for the pointer", () => {
    for (const type of TASK_TYPES) {
      const { getByRole, unmount } = render(<TypeIcon type={type} />);
      expect(getByRole("img", { name: TYPE_LABEL[type] })).toBeTruthy();
      unmount();
    }
  });
});

describe("status glyph", () => {
  it("fills as the work progresses: ring, half ring, disc", () => {
    const empty = render(<StatusRing status="backlog" />);
    expect(empty.container.querySelector("circle")?.getAttribute("fill")).toBe("none");

    const half = render(<StatusRing status="executing" />);
    // The ring plus the filled half.
    expect(half.container.querySelectorAll("circle")).toHaveLength(1);
    expect(half.container.querySelectorAll("path")).toHaveLength(1);

    const done = render(<StatusRing status="done" />);
    expect(done.container.querySelector("circle")?.getAttribute("fill")).not.toBe("none");
    expect(done.container.querySelector("title")?.textContent).toBe(STATUS_LABEL.done);
  });
});
