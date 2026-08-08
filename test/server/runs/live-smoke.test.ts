/**
 * The live smoke tests (T54's Done line: "one live smoke test gated on
 * credentials").
 *
 * Every other test in this folder drives the scripted agent. These drive the
 * real `@anthropic-ai/claude-agent-sdk` against a throwaway workspace, so the
 * wiring — options, the permission callback, the message translation, the
 * operation records — is exercised end to end at least once.
 *
 * There are two, because the two safety modes exercise different halves of
 * the SDK's permission plumbing:
 *
 * - `allow_all`, which proves a run can execute and record work; and
 * - `ask_all`, which proves that *every* operation reaches `canUseTool` —
 *   including a read. docs/10 §4 says ask everything "includes read
 *   operations", and specs/09's acceptance criteria say the first read
 *   operation parks. The SDK's own `permissionMode: "default"` is documented
 *   as prompting "for dangerous operations", so the read path is the one that
 *   has to be seen working rather than assumed.
 *
 * They skip themselves when no Anthropic credential is present. PAIM never
 * stores a key; the SDK reads `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or
 * an `ant auth login` profile from the environment (docs/09 "Credentials"),
 * and `aiAvailable()` is the same check the service logs at startup.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiAvailable } from "../../../src/server/ai/client.js";
import { openDatabase } from "../../../src/server/db/index.js";
import { insertProject } from "../../../src/server/db/projects.js";
import { insertRun, listOperations } from "../../../src/server/db/runs.js";
import { insertTask } from "../../../src/server/db/tasks.js";
import { defaultSettings } from "../../../src/server/projects/defaults.js";
import { createApprovalRegistry } from "../../../src/server/runs/approvals.js";
import { executeRun } from "../../../src/server/runs/runner.js";
import { createSdkAgent } from "../../../src/server/runs/sdkAgent.js";
import type { Run } from "../../../src/shared/runs.js";
import type { Project, SafetyPolicy, Task } from "../../../src/shared/types.js";

let dir: string;
let workspace: string;
let db: Database.Database;

// Never `data/`: the run writes into a throwaway workspace, and the records
// go into a throwaway database.
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "paim-live-"));
  workspace = mkdtempSync(join(tmpdir(), "paim-live-workspace-"));
  db = openDatabase(join(dir, "paim.db"));
});

afterAll(() => {
  db?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (workspace) rmSync(workspace, { recursive: true, force: true });
});

function makeProject(safety: SafetyPolicy): Project {
  const now = new Date().toISOString();
  return insertProject(db, {
    ...defaultSettings(),
    id: randomUUID(),
    slug: `live-${randomUUID()}`,
    name: "Live",
    workspacePath: workspace,
    safety,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
}

function makeTask(project: Project, fields: Pick<Task, "key" | "title" | "description">): Task {
  const now = new Date().toISOString();
  return insertTask(db, {
    ...fields,
    id: randomUUID(),
    projectId: project.id,
    status: project.statuses[0]!,
    priority: "none",
    size: "XS",
    kind: "task",
    labels: [],
    assignee: null,
    parentId: null,
    order: 0,
    fields: {},
    model: null,
    effort: null,
    safety: null,
    childManualReview: null,
    schedule: null,
    dependsOn: [],
    questions: [],
    designOptions: [],
    tests: [],
    reviews: [],
    sourcePrompt: fields.description,
    evaluatedAt: null,
    staleReason: null,
    failureReason: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  });
}

function makeRun(task: Task): Run {
  return insertRun(db, {
    id: randomUUID(),
    taskId: task.id,
    projectId: task.projectId,
    kind: "single",
    parentRunId: null,
    trigger: "manual",
    status: "queued",
    restorePoint: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    failureReason: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
  });
}

describe.runIf(aiAvailable())("live agent smoke test", () => {
  it(
    "runs a real agent in the workspace and records what it did",
    async () => {
      // This one is unattended: nothing may park on a person.
      const project = makeProject({ denyList: [], mode: "allow_all", askList: [] });
      const task = makeTask(project, {
        key: "LIVE-1",
        title: "Create a greeting file",
        description:
          "Create a file named hello.txt in the current directory whose only content is: hello from paim",
      });
      const run = makeRun(task);

      const outcome = await executeRun({
        db,
        run,
        task,
        project,
        agent: createSdkAgent(),
        approvals: createApprovalRegistry(),
        model: null,
      });

      expect(outcome.run.status).toBe("succeeded");
      expect(outcome.run.usage.inputTokens).toBeGreaterThan(0);
      expect(existsSync(join(workspace, "hello.txt"))).toBe(true);

      const operations = listOperations(db, run.id);
      expect(operations.length).toBeGreaterThan(0);
      expect(operations.every((operation) => operation.status !== "proposed")).toBe(true);
    },
    240_000,
  );

  it(
    "parks every operation under ask_all, reads included",
    async () => {
      // docs/10 §4: "Every operation waits for approval. This includes read
      // operations." The point of this test is that a Read/Glob/Grep really
      // does reach `canUseTool` — if the SDK auto-allowed read-only tools,
      // reads would neither park nor be recorded at all.
      writeFileSync(join(workspace, "notes.txt"), "the answer is jackdaw\n", "utf8");

      const project = makeProject({ denyList: [], mode: "ask_all", askList: [] });
      const task = makeTask(project, {
        key: "LIVE-2",
        title: "Report the contents of a file",
        description:
          "Read the file notes.txt in the current directory and reply with its contents. Do not modify any file.",
      });
      const run = makeRun(task);
      const approvals = createApprovalRegistry();

      // Stands in for the approve endpoint (T56): answers yes to everything
      // that parks, so the run can finish unattended, and remembers what it
      // answered.
      const answered: string[] = [];
      let pumping = true;
      const pump = (async () => {
        while (pumping) {
          for (const operationId of approvals.pending()) {
            answered.push(operationId);
            approvals.approve(operationId);
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      })();

      let outcome;
      try {
        outcome = await executeRun({
          db,
          run,
          task,
          project,
          agent: createSdkAgent(),
          approvals,
          model: null,
        });
      } finally {
        pumping = false;
        await pump;
      }

      expect(outcome.run.status).toBe("succeeded");

      const operations = listOperations(db, run.id);
      expect(operations.length).toBeGreaterThan(0);
      // Every recorded operation parked first — nothing slipped past the
      // permission callback.
      expect(operations.map((operation) => operation.id).sort()).toEqual([...answered].sort());
      // And at least one of them was a read-shaped operation.
      const reads = operations.filter((operation) =>
        ["read", "glob", "grep"].includes(operation.kind),
      );
      expect(reads.length).toBeGreaterThan(0);
    },
    240_000,
  );
});
