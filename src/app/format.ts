/* Small pure formatters the shell shares. */

import type { IdentityTone } from "../ui/vocabulary";
import { IDENTITY_TONES } from "../ui/vocabulary";
import type { ProjectView } from "../shared/types.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * "18m ago", "2h ago", "yesterday", "3d ago". Past a fortnight the exact date
 * says more than a count of days.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const delta = now - then;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 2 * DAY) return "yesterday";
  if (delta < 14 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Closed work as a percentage. A project with no tasks is at zero, not NaN. */
export function progressPercent(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** The project's identity tone, or the neutral one when it has no colour. */
export function projectTone(project: Pick<ProjectView, "color">): IdentityTone {
  const colour = project.color;
  if (colour && (IDENTITY_TONES as readonly string[]).includes(colour)) {
    return colour as IdentityTone;
  }
  return "grey";
}

/** docs/13: every project shows a glyph; one is supplied when none is set. */
export const DEFAULT_PROJECT_GLYPH = "◈";

export function projectGlyph(project: Pick<ProjectView, "icon">): string {
  return project.icon && project.icon.trim() !== "" ? project.icon : DEFAULT_PROJECT_GLYPH;
}
