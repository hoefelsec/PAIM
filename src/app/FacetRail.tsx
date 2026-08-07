/* The facet rail on the table screen (docs/07 "Filter facets").
 *
 *   ▾ STATUS                pipeline
 *     ☑ Ready              5
 *     ☑ Executing          3
 *   ▾ PRIORITY                  core
 *   › LAYER                   schema
 *   ────────────────────────────────
 *   Clear all                      2
 *
 * The rail controls which tasks are in the set; the toolbar controls how the
 * set appears (docs/07 "The rule for filters and presentation"). So there is
 * no sort, no grouping and no column control here.
 *
 * Checking a box writes the address and nothing else — the filter state has
 * exactly one home (docs/07 "Saved views": "Filter state lives in the URL
 * query string"). The table reads the same query string back, which is why
 * pasting a filtered link reproduces the list and Back restores the previous
 * filters without any component holding a copy.
 *
 * The facets themselves come from src/app/facets.ts: generated from the
 * project's pipeline and field schema, never hardcoded.
 */

import { useMemo, useState } from "react";
import { SizePill } from "../ui/controls";
import { PriorityIcon, StatusRing, TypeIcon } from "../ui/shapes";
import {
  PRIORITIES,
  SIZES,
  STATUSES,
  TASK_TYPES,
  type Priority,
  type Size,
  type Status,
  type TaskType,
} from "../ui/vocabulary";
import {
  activeFilterCount,
  buildFacets,
  facetCounts,
  parseFilters,
  serializeFilters,
  toggleFilter,
  visibleOptions,
  type Facet,
  type FacetOption,
  type Filters,
} from "./facets";
import { useProject, useTasks } from "./queries";
import { useLocation, useNavigate } from "./router";

/** Whether the shape language has a glyph for this value. An address can name
 *  anything, and a value the vocabulary does not know gets no mark. */
const drawn = <T extends string>(pool: readonly T[], value: string): value is T =>
  (pool as readonly string[]).includes(value);

/** The mark beside an option. Hidden from the accessible name: the option's
 *  own text already says what it is, and the glyph would repeat it. */
function OptionGlyph({ facet, value }: { facet: Facet; value: string }) {
  const glyph =
    facet.glyph === "status" && drawn<Status>(STATUSES, value) ? (
      <StatusRing status={value} size={9} />
    ) : facet.glyph === "priority" && drawn<Priority>(PRIORITIES, value) ? (
      <PriorityIcon priority={value} size={11} />
    ) : facet.glyph === "size" && drawn<Size>(SIZES, value) ? (
      <SizePill size={value} />
    ) : facet.glyph === "type" && drawn<TaskType>(TASK_TYPES, value) ? (
      <TypeIcon type={value} size={12} />
    ) : null;

  return (
    <span aria-hidden="true" className="inline-flex w-[42px] shrink-0 justify-start">
      {glyph}
    </span>
  );
}

function FacetItem({
  facet,
  option,
  count,
  checked,
  onToggle,
}: {
  facet: Facet;
  option: FacetOption;
  count: number;
  checked: boolean;
  onToggle: (id: string, value: string) => void;
}) {
  return (
    <label
      data-facet-item={option.value}
      className={`flex h-[25px] cursor-pointer items-center gap-2 rounded-ctl py-1 pr-2 pl-[22px]
                  text-prop transition-colors duration-(--dur-hover-out)
                  hover:bg-surface hover:text-tx-primary hover:duration-(--dur-hover-in)
                  ${checked ? "text-tx-primary" : "text-tx-secondary"}`}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(facet.id, option.value)}
        className="size-3 shrink-0 accent-[var(--color-accent-solid)]"
      />
      <OptionGlyph facet={facet} value={option.value} />
      <span className="truncate">{option.label}</span>
      <span className="ml-auto text-label text-tx-muted" data-numeric>
        {count}
      </span>
    </label>
  );
}

function FacetBlock({
  facet,
  filters,
  counts,
  open,
  onOpen,
  onToggle,
}: {
  facet: Facet;
  filters: Filters;
  counts: Map<string, number>;
  open: boolean;
  onOpen: (id: string, open: boolean) => void;
  onToggle: (id: string, value: string) => void;
}) {
  const selected = filters[facet.id] ?? [];
  const options = visibleOptions(facet, selected);

  return (
    <section data-facet={facet.id} className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpen(facet.id, !open)}
        className="flex items-center gap-[7px] px-2 py-1.5 font-mono text-label uppercase
                   tracking-[0.11em] text-tx-muted transition-colors
                   duration-(--dur-hover-out) hover:text-tx-secondary
                   hover:duration-(--dur-hover-in)"
      >
        <span aria-hidden="true" className="w-[9px] text-[10px] leading-none">
          {open ? "▾" : "›"}
        </span>
        {facet.label}
        {selected.length > 0 && (
          <span className="text-accent normal-case" data-numeric>
            {selected.length}
          </span>
        )}
        {/* docs/07: the head says where the facet comes from. */}
        <span className="ml-auto text-[9px] tracking-[0.06em] normal-case text-bd-strong">
          {facet.source}
        </span>
      </button>

      {open &&
        options.map((option) => (
          <FacetItem
            key={option.value}
            facet={facet}
            option={option}
            count={counts.get(option.value) ?? 0}
            checked={selected.includes(option.value)}
            onToggle={onToggle}
          />
        ))}
    </section>
  );
}

/**
 * `/p/:project` — the rail beside the table. It reads the project and the
 * tasks from the same query cache the table uses, so the counts are the live
 * ones and the rail costs no extra request.
 */
export function FacetRail({ slug }: { slug: string }) {
  const project = useProject(slug);
  const tasks = useTasks(slug);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [openState, setOpenState] = useState<Record<string, boolean>>({});

  const loaded = tasks.data ?? [];
  const schema = project.data?.fieldSchema ?? [];
  const filters = useMemo(() => parseFilters(search), [search]);
  const facets = useMemo(() => buildFacets(project.data, loaded), [project.data, loaded]);
  const counts = useMemo(
    () => facets.map((facet) => facetCounts(facet, loaded, filters, schema)),
    [facets, loaded, filters, schema],
  );

  if (facets.length === 0) return null;

  const active = activeFilterCount(filters);
  const go = (next: Filters) => navigate(`${pathname}${serializeFilters(next, search)}`);

  return (
    <div
      aria-label="Filters"
      className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-2 py-3"
    >
      {facets.map((facet, index) => {
        const selected = filters[facet.id] ?? [];
        const facetCount = counts[index] ?? new Map<string, number>();
        // A facet with nothing behind it starts shut: an empty head is a
        // promise that the project could have that filter, not a control.
        const fallbackOpen =
          selected.length > 0 || [...facetCount.values()].some((count) => count > 0);
        return (
          <FacetBlock
            key={facet.id}
            facet={facet}
            filters={filters}
            counts={facetCount}
            open={openState[facet.id] ?? fallbackOpen}
            onOpen={(id, open) => setOpenState((current) => ({ ...current, [id]: open }))}
            onToggle={(id, value) => go(toggleFilter(filters, id, value))}
          />
        );
      })}

      <div className="mt-auto flex items-center gap-2 border-t border-bd-subtle px-2 pt-2.5">
        <button
          type="button"
          onClick={() => go({})}
          disabled={active === 0}
          className="text-prop text-tx-muted transition-colors duration-(--dur-hover-out)
                     hover:text-tx-primary hover:duration-(--dur-hover-in)
                     disabled:pointer-events-none disabled:opacity-40"
        >
          Clear all
        </button>
        {active > 0 && (
          <span className="font-medium text-accent" data-numeric data-testid="active-filters">
            {active}
          </span>
        )}
      </div>
    </div>
  );
}
