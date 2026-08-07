/* The open editor of an in-place edit (docs/07 "Editing", T21).
 *
 * docs/07: "Click a value, change it, and click outside to save. There are no
 * modal forms and no Save control." — so the control commits itself: blur or
 * Enter saves, Esc cancels, and a menu commits on the choice, because a
 * native select closes on choosing and asking for Enter afterwards would be
 * a Save button spelled differently.
 *
 * It lives here rather than inside the table because two surfaces open the
 * same editor over the same {@link EditorSpec}: a cell of the table
 * (src/app/TaskTable.tsx) and a row of the task view's properties column
 * (src/app/TaskView.tsx). The label a screen reader hears is the same in
 * both — "Prio of FEAT-4" — so an edit is one thing wherever it is made.
 */

import { useEffect, useRef, useState } from "react";
import type { EditorSpec } from "./edit";
import type { TaskView } from "./table";

/** The look of the control. One density: it fits a 33 pixel table row. */
export const CONTROL =
  "h-[23px] w-full min-w-0 rounded-[4px] border border-bd-strong bg-raised px-1 " +
  "text-row text-tx-primary outline-none focus:border-accent";

export function ValueEditor({
  spec,
  task,
  onCommit,
  onCancel,
  className = CONTROL,
}: {
  spec: EditorSpec;
  task: TaskView;
  onCommit: (task: TaskView, spec: EditorSpec, raw: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(() => spec.read(task));
  const control = useRef<HTMLInputElement | HTMLSelectElement>(null);
  // Commit and cancel both close the editor. A select commits on change and
  // then blurs on the way out, so the second call must do nothing.
  const settled = useRef(false);

  useEffect(() => {
    control.current?.focus();
    if (control.current instanceof HTMLInputElement) control.current.select();
  }, []);

  const commit = (raw: string) => {
    if (settled.current) return;
    settled.current = true;
    onCommit(task, spec, raw);
  };

  const cancel = () => {
    if (settled.current) return;
    settled.current = true;
    onCancel();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  const label = `${spec.label} of ${task.key}`;

  if (spec.kind === "select") {
    // A stored value the schema no longer offers still shows (docs/03 rule 2:
    // a field change never rewrites stored values), so the menu carries it.
    const options = spec.options.some((option) => option.value === value)
      ? spec.options
      : [...spec.options, { value, label: value }];

    return (
      <select
        ref={control as React.RefObject<HTMLSelectElement>}
        aria-label={label}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          commit(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => commit(value)}
        className={className}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={control as React.RefObject<HTMLInputElement>}
      type="text"
      // A number field takes the numeric keyboard, not a stepper: the service
      // is the one that decides whether the text is a number.
      inputMode={spec.kind === "number" ? "decimal" : undefined}
      aria-label={label}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => commit(value)}
      className={className}
    />
  );
}
