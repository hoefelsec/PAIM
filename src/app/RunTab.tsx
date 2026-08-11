/* The Run tab of the task view (T69; docs/07 "The task view", docs/09).
 *
 *   ● Awaiting approval   7 operations · 5 done · 1 refused · 1 awaiting you
 *                                        ~/Projects/paim      ↺ Restore
 *   ┌───────────────────────────────────────────────────────────────────┐
 *   │ GREP  encodeCursor                                       ✓ done   │
 *   │ EDIT  src/api/tasks.ts                                   ✓ done   │
 *   │  @@ -142,7 +142,9 @@ …                                            │
 *   │ BASH  git push --force origin fix/cursor        ⊘ refused         │
 *   │  ↪ Refused, and the model was told why. It continued with …       │
 *   │ BASH  git push origin fix/cursor          [ Deny ] [ Approve ]    │
 *   └───────────────────────────────────────────────────────────────────┘
 *   claude-opus-5 · medium · 1m 12s · 38.4k in / 3.1k out · $0.27
 *
 * "The Run tab answers 'what happened, in order'" (docs/07) — so this screen
 * is a log, not a dashboard. Three things give it its shape:
 *
 * - **Risk is the only colour.** docs/13 "Operation risk colours": on a run
 *   screen the question is "what can this operation change on my machine?",
 *   and the accent answers it rather than marking interaction. Neutral for
 *   read/glob/grep, the accent for write/edit, clay for bash.
 * - **Every limit is stated where it applies.** docs/09: an operation Restore
 *   cannot revert says so on its own row, and the Restore control is replaced
 *   by the reason when a capture failed — never hidden without explanation.
 * - **A refusal is not an ending.** docs/10 §3 returns the refusal and its
 *   reason to the model and the run continues, so a denied row shows the
 *   reason *and* what the model did next.
 *
 * The log arrives over `GET /api/runs/:run/stream` (./runStream.ts), folded
 * into the cache one frame at a time.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "../ui/controls";
import { RISK_VAR } from "../ui/vocabulary";
import { ApiError } from "./api";
import { relativeTime } from "./format";
import {
  adaptationAfter,
  DIFF_LINE_VAR,
  denialReason,
  describeRestore,
  describeTally,
  flagsIrreversible,
  formatCost,
  formatDuration,
  formatModel,
  formatTokens,
  isPendingOperation,
  isRunActive,
  operationTarget,
  OPERATION_STATUS_LABEL,
  parseDiff,
  restoreOffer,
  resolveTaskModel,
  runDurationMs,
  RUN_STATUS_LABEL,
  RUN_STATUS_VAR,
  tallyOperations,
} from "./run";
import {
  useApproveOperation,
  useDenyOperation,
  useRestoreRun,
  useRun,
  useRuns,
} from "./queries";
import { useRunStream } from "./runStream";
import type { TaskView } from "./table";
import type { Operation, Run, RunView } from "../shared/runs.js";
import type { ProjectView } from "../shared/types.js";

/* ── the run state bar ──────────────────────────────────────────────────── */

function RunState({ status }: { status: Run["status"] }) {
  const colour = RUN_STATUS_VAR[status];
  return (
    <span
      data-slot="run-state"
      data-state={status}
      className="inline-flex items-center gap-[7px] rounded-full px-2.5 py-[3px]
                 font-mono text-label uppercase tracking-[0.1em]"
      style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
    >
      <span
        aria-hidden="true"
        className={`size-[5px] shrink-0 rounded-full ${isRunActive(status) ? "animate-pulse" : ""}`}
        style={{ background: "currentColor" }}
      />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

/* ── one operation ──────────────────────────────────────────────────────── */

/** The kind badge, and the one place the accent means risk (docs/13). */
function KindBadge({ operation }: { operation: Operation }) {
  const colour = RISK_VAR[operation.risk];
  return (
    <span
      data-slot="op-kind"
      className="min-w-14 shrink-0 rounded-[4px] px-[7px] py-0.5 text-center font-mono
                 text-label uppercase tracking-[0.09em]"
      style={{ color: colour, background: `color-mix(in srgb, ${colour} 14%, transparent)` }}
    >
      {operation.kind}
    </span>
  );
}

function Diff({ diff }: { diff: string }) {
  return (
    <pre
      data-slot="op-diff"
      className="overflow-x-auto border-t border-bd-subtle bg-base py-1 font-mono
                 text-id leading-[1.65]"
    >
      {parseDiff(diff).map((line, index) => {
        const colour = DIFF_LINE_VAR[line.kind];
        return (
          <div
            // A diff line has no identity of its own; its position is it.
            key={index}
            data-diff={line.kind}
            className="px-[11px]"
            style={{
              ...(colour === null ? {} : { color: colour }),
              ...(line.kind === "add" || line.kind === "del"
                ? { background: `color-mix(in srgb, ${colour} 10%, transparent)` }
                : {}),
              ...(line.kind === "hunk" ? { background: "var(--color-raised)" } : {}),
            }}
          >
            {line.text === "" ? " " : line.text}
          </div>
        );
      })}
    </pre>
  );
}

/** docs/09 "Records": `stdout` and `exitCode` belong to a bash operation. */
function Terminal({ operation }: { operation: Operation }) {
  return (
    <pre
      data-slot="op-stdout"
      className="overflow-x-auto border-t border-bd-subtle bg-base px-[11px] py-2
                 font-mono text-id leading-[1.7] text-tx-secondary"
    >
      {operation.stdout}
      {operation.exitCode !== null && (
        <div
          data-slot="op-exit"
          style={{
            color:
              operation.exitCode === 0 ? "var(--color-st-done)" : "var(--color-pr-urgent)",
          }}
        >
          exit {operation.exitCode}
        </div>
      )}
    </pre>
  );
}

interface OperationRowProps {
  operation: Operation;
  /** What the model did next — the row of a refusal says so (docs/10 §3). */
  adaptation: string | null;
  reason: string;
  busy: boolean;
  onApprove: (operationId: string) => void;
  onDeny: (operationId: string, reason: string) => void;
}

function OperationRow({
  operation,
  adaptation,
  reason,
  busy,
  onApprove,
  onDeny,
}: OperationRowProps) {
  const [denying, setDenying] = useState(false);
  const [why, setWhy] = useState("");

  const denied = operation.status === "denied";
  const pending = isPendingOperation(operation);
  const irreversible = flagsIrreversible(operation);

  return (
    <li
      data-operation={operation.id}
      data-kind={operation.kind}
      data-risk={operation.risk}
      data-status={operation.status}
      className={`overflow-hidden rounded-ctl border bg-surface ${
        pending
          ? "border-st-executing/35 bg-st-executing/5"
          : denied
            ? "border-pr-urgent/30 bg-pr-urgent/5"
            : "border-bd-subtle"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2.5 px-[11px] py-2">
        <KindBadge operation={operation} />
        <span
          data-slot="op-summary"
          className={`min-w-0 font-mono text-id ${
            denied ? "text-pr-urgent line-through" : "text-tx-primary"
          }`}
        >
          {operationTarget(operation)}
        </span>
        {denied && (
          <span data-slot="op-reason" className="text-prop text-tx-muted">
            {reason}
          </span>
        )}
        {pending && !denying && (
          <span data-slot="op-note" className="text-prop text-tx-muted">
            {OPERATION_STATUS_LABEL.proposed}
          </span>
        )}

        <span data-slot="op-state" className="ml-auto flex items-center gap-2 text-prop text-tx-muted">
          {pending ? (
            denying ? (
              <>
                <input
                  autoFocus
                  aria-label={`Why ${operation.summary} is refused`}
                  value={why}
                  onChange={(event) => setWhy(event.target.value)}
                  placeholder="Why? The model is told."
                  className="w-56 rounded-ctl border border-bd-strong bg-raised px-2 py-0.5
                             text-prop text-tx-primary outline-none"
                />
                <Button
                  variant="danger"
                  onClick={() => {
                    setDenying(false);
                    onDeny(operation.id, why);
                  }}
                >
                  Refuse
                </Button>
                <Button variant="quiet" onClick={() => setDenying(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button variant="default" disabled={busy} onClick={() => setDenying(true)}>
                  Deny
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => onApprove(operation.id)}>
                  Approve
                </Button>
              </>
            )
          ) : (
            <span data-slot="op-status-label">
              {operation.status === "done" && (
                <span aria-hidden="true" className="text-st-done">
                  ✓{" "}
                </span>
              )}
              {denied && (
                <span aria-hidden="true" className="text-pr-urgent">
                  ⊘{" "}
                </span>
              )}
              {OPERATION_STATUS_LABEL[operation.status]}
            </span>
          )}
        </span>
      </div>

      {/* docs/09: "An operation that Restore cannot revert says so on its own
          row" — not in small print somewhere else on the screen. */}
      {irreversible && (
        <p
          data-slot="op-irreversible"
          className="border-t border-pr-urgent/20 px-[11px] py-1.5 text-prop text-tx-muted"
        >
          <span aria-hidden="true">⚠ </span>
          <strong className="font-medium text-tx-secondary">Restore can’t undo this.</strong>{" "}
          A shell command can install a package, push a commit or apply a migration, and none
          of that comes back.
        </p>
      )}

      {denied && (
        <p
          data-slot="op-adaptation"
          className="border-t border-pr-urgent/20 px-[11px] py-1.5 text-prop text-tx-muted"
        >
          <span aria-hidden="true">↪ </span>
          <strong className="font-medium text-tx-secondary">
            Refused, and the model was told why.
          </strong>{" "}
          {adaptation === null
            ? "The run has proposed nothing since."
            : `It continued with ${adaptation}.`}
        </p>
      )}

      {operation.diff !== null && operation.diff !== "" && <Diff diff={operation.diff} />}
      {operation.kind === "bash" && operation.stdout !== null && operation.stdout !== "" && (
        <Terminal operation={operation} />
      )}
    </li>
  );
}

/* ── Restore ────────────────────────────────────────────────────────────── */

function RestoreConfirm({
  irreversible,
  busy,
  onConfirm,
  onCancel,
}: {
  irreversible: readonly Operation[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Restore the workspace"
      data-slot="restore-confirm"
      className="flex flex-col gap-2 rounded-card border border-st-executing/35
                 bg-st-executing/5 p-3"
    >
      <p className="text-prop text-tx-secondary">
        Restore returns the files to the state before this run and deletes the files it
        created.
      </p>
      {irreversible.length > 0 && (
        <p data-slot="restore-limit" className="text-prop text-tx-muted">
          It cannot undo{" "}
          {irreversible.map((operation) => operation.summary).join(", ")}. What that changed
          outside the workspace stays changed.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          Restore the workspace
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Keep the changes
        </Button>
      </div>
    </div>
  );
}

/* ── the tab ────────────────────────────────────────────────────────────── */

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-row text-tx-muted">{children}</p>;
}

export function RunTab({
  slug,
  project,
  task,
}: {
  slug: string;
  project: ProjectView;
  task: TaskView;
}) {
  const runs = useRuns(slug, task.key);
  /** null means "the newest run", so a new run takes over on its own. */
  const [chosen, setChosen] = useState<string | null>(null);

  const list = runs.data ?? [];
  const runId = chosen ?? list[0]?.id ?? null;

  const query = useRun(runId);
  useRunStream(runId);

  /**
   * The reasons this tab sent with a refusal. The service hands a reason to
   * the model rather than storing it on the operation, so a row can only
   * quote a refusal the user made here (see ./run.ts `denialReason`).
   */
  const [denials, setDenials] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [confirming, setConfirming] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);

  const approve = useApproveOperation(slug, task.key, runId);
  const deny = useDenyOperation(slug, task.key, runId);
  const restore = useRestoreRun(slug, task.key, runId);

  // Both belong to the run on screen: an open confirmation, or the report of
  // a revert, must not carry over to the next run the user opens.
  useEffect(() => {
    setConfirming(false);
    setRestored(null);
  }, [runId]);

  const run: RunView | undefined = query.data;
  const operations = useMemo(() => run?.operations ?? [], [run]);
  const tally = useMemo(() => tallyOperations(operations), [operations]);
  const model = useMemo(() => resolveTaskModel(project, task), [project, task]);
  const irreversible = useMemo(() => operations.filter(flagsIrreversible), [operations]);

  const failure = [approve.error, deny.error, restore.error].find(
    (error): error is Error => error != null,
  );

  if (runs.isPending) {
    return (
      <section data-tab="run" className="p-5">
        <Empty>Loading runs…</Empty>
      </section>
    );
  }

  if (runs.isError) {
    return (
      <section data-tab="run" className="p-5">
        <Empty>The runs of this task could not be read.</Empty>
      </section>
    );
  }

  if (runId === null) {
    return (
      <section data-tab="run" className="flex flex-col gap-2 p-5">
        <Empty>This task has not run yet.</Empty>
        <p className="text-prop text-tx-muted">
          Press <kbd className="font-mono text-id">R</kbd> to run it.
        </p>
      </section>
    );
  }

  if (run === undefined) {
    return (
      <section data-tab="run" className="p-5">
        <Empty>{query.isError ? "The run could not be read." : "Loading the run…"}</Empty>
      </section>
    );
  }

  const offer = restoreOffer(run, task.status);
  const duration = runDurationMs(run, Date.now());
  const workspace = project.workspacePath;

  return (
    <section data-tab="run" className="flex min-w-0 flex-col gap-3 p-5">
      {list.length > 1 && (
        <div data-slot="run-picker" className="flex flex-wrap items-center gap-1.5">
          {list.map((entry, index) => (
            <button
              key={entry.id}
              data-run={entry.id}
              aria-pressed={entry.id === runId}
              onClick={() => setChosen(entry.id)}
              className={`rounded-ctl border px-2 py-0.5 font-mono text-label uppercase
                          tracking-[0.08em] ${
                            entry.id === runId
                              ? "border-accent/45 bg-accent/10 text-tx-primary"
                              : "border-bd-subtle bg-raised text-tx-muted"
                          }`}
            >
              {index === 0 ? "latest" : `run ${list.length - index}`} ·{" "}
              {RUN_STATUS_LABEL[entry.status]} · {relativeTime(entry.createdAt)}
            </button>
          ))}
        </div>
      )}

      <div data-slot="run-bar" className="flex flex-wrap items-center gap-3">
        <RunState status={run.status} />
        <span data-slot="run-meta" className="text-prop text-tx-muted" data-numeric>
          {describeTally(tally)}
        </span>

        <span
          data-slot="workspace-path"
          className="ml-auto rounded-[4px] border border-bd-subtle bg-raised px-2 py-0.5
                     font-mono text-label text-tx-muted"
        >
          {workspace === null || workspace === "" ? "no workspace set" : workspace}
        </span>

        {offer.state === "offered" && (
          <Button variant="default" onClick={() => setConfirming(true)}>
            <span aria-hidden="true">↺</span> Restore
          </Button>
        )}
        {/* docs/09: "The Run tab states the reason in the position of the
            Restore control." The absence of the control is never silent. */}
        {offer.state === "unavailable" && (
          <span data-slot="restore-unavailable" className="text-prop text-tx-muted">
            Restore is not available: {offer.reason}
          </span>
        )}
      </div>

      {confirming && offer.state === "offered" && (
        <RestoreConfirm
          irreversible={irreversible}
          busy={restore.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            restore.mutate(undefined, {
              onSuccess: (outcome) => setRestored(describeRestore(outcome)),
            });
          }}
        />
      )}

      {restored !== null && (
        <p data-slot="restore-done" className="text-prop text-tx-secondary">
          The workspace is back to the state before this run — {restored}.
        </p>
      )}

      {failure && (
        <p data-slot="run-error" role="alert" className="text-prop text-pr-urgent">
          {failure instanceof ApiError ? failure.message : "That control did not go through."}
        </p>
      )}

      {run.failureReason !== null && (
        <p data-slot="run-failure" className="text-prop text-pr-urgent">
          {run.failureReason}
        </p>
      )}

      {operations.length === 0 ? (
        <Empty>
          {run.status === "planning" || run.status === "queued"
            ? "The agent has proposed nothing yet."
            : "This run performed no operations."}
        </Empty>
      ) : (
        <ul data-slot="operations" className="flex flex-col gap-2">
          {operations.map((operation, index) => (
            <OperationRow
              key={operation.id}
              operation={operation}
              adaptation={adaptationAfter(operations, index)}
              reason={denialReason(operation, denials)}
              busy={approve.isPending || deny.isPending}
              onApprove={(id) => approve.mutate(id)}
              onDeny={(id, why) => {
                const worded = why.trim();
                if (worded !== "") {
                  setDenials((current) => new Map(current).set(id, worded));
                }
                deny.mutate({ operationId: id, reason: why });
              }}
            />
          ))}
        </ul>
      )}

      <p data-slot="runfoot" className="text-prop text-tx-muted" data-numeric>
        {formatModel(model)}
        {duration !== null && ` · ${formatDuration(duration)}`} ·{" "}
        {formatTokens(run.usage.inputTokens)} in / {formatTokens(run.usage.outputTokens)} out ·{" "}
        {formatCost(run.usage.costUsd)}
      </p>
    </section>
  );
}
