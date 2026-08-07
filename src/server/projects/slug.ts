/**
 * Slugs address a project in every API path (docs/02, docs/06). They are
 * URL-safe, unique and permanent — an update that changes one fails with
 * `422 SLUG_IMMUTABLE`.
 */

/** Lowercase alphanumerics separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MAX_SLUG_LENGTH = 64;

/** Used when a name contains no slug-able character at all (e.g. "***"). */
const FALLBACK_SLUG = "project";

/**
 * Derives a URL-safe slug from arbitrary text: strips diacritics, lowercases,
 * turns every run of non-alphanumerics into a single hyphen and trims the
 * hyphens off both ends.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    // Combining marks left behind by NFKD ("é" -> "e" + U+0301).
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return base.length > 0 ? base : FALLBACK_SLUG;
}

export function isValidSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

/**
 * Returns `base`, or the first `base-2`, `base-3`, … that `isTaken` rejects.
 * Only derived slugs get a suffix; an explicitly supplied slug that collides
 * is an error the caller reports instead.
 */
export function uniqueSlug(base: string, isTaken: (slug: string) => boolean): string {
  if (!isTaken(base)) return base;

  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const trimmed = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, "");
    const candidate = `${trimmed}${suffix}`;
    if (!isTaken(candidate)) return candidate;
  }
}
