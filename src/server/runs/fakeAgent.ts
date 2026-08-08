/**
 * A scripted {@link Agent} (specs/09-ai-run.md: "Wrap the runner behind a
 * `FakeAgent` interface so tests script transcripts without the SDK").
 *
 * The fake plays a written transcript of tool calls. For each one it asks
 * the runner for permission exactly as the SDK would, then behaves the way
 * the SDK behaves with the answer it gets:
 *
 * - allowed → the scripted result is emitted;
 * - denied → the tool never runs and the refusal comes back as the tool's
 *   result, `isError: true` (docs/10 §3), and the transcript continues —
 *   which is how a test shows that a denial does not end the run.
 *
 * An `ask` decision is not scripted at all: the fake simply waits on the
 * runner's promise, so the run parks exactly as it does in production and
 * the test answers through the approval registry.
 *
 * This lives in `src/` rather than `test/` on purpose: it is the second
 * implementation of the seam, and the run-control, pipeline, and stream
 * work (T56, T59, T61) all drive their tests through it.
 */

import type { RunUsage } from "../../shared/runs.js";
import {
  emptyUsage,
  type Agent,
  type AgentMessage,
  type AgentPermissionDecision,
  type AgentRequest,
} from "./agent.js";

/** What the tool returns when the runner allows it. */
export interface FakeToolOutcome {
  /** The text the model sees. Defaults to `"ok"`. */
  text?: string;
  /** bash only. */
  stdout?: string | null;
  /** bash only. */
  exitCode?: number | null;
  /** Whether the tool itself failed. */
  isError?: boolean;
}

/** One tool call in the transcript. */
export interface FakeToolStep {
  name: string;
  input: Record<string, unknown>;
  /** Defaults to a generated `tool_use_<n>`. */
  toolUseId?: string;
  /** The result emitted when the runner allows the call. */
  outcome?: FakeToolOutcome;
  /**
   * Called after the decision comes back, before the result is emitted.
   * Lets a test observe the transcript as it plays — or answer a *later*
   * step's approval.
   */
  onDecision?: (decision: AgentPermissionDecision) => void | Promise<void>;
}

export interface FakeAgentScript {
  steps?: FakeToolStep[];
  /** The final result message. Omit for a zero-usage success. */
  result?: {
    ok?: boolean;
    usage?: Partial<RunUsage>;
    errorMessage?: string | null;
  } | null;
  /** Thrown mid-transcript, after `throwAfter` steps, to test crash paths. */
  throwAfter?: number;
  error?: Error;
}

export interface FakeAgent extends Agent {
  /** Every request the runner made; one per `executeRun`. */
  readonly requests: AgentRequest[];
  /** Names of the tools the fake actually offered, in order. */
  readonly attempted: string[];
  /** The decision the runner returned for each attempted tool, in order. */
  readonly decisions: AgentPermissionDecision[];
}

export function createFakeAgent(script: FakeAgentScript = {}): FakeAgent {
  const requests: AgentRequest[] = [];
  const attempted: string[] = [];
  const decisions: AgentPermissionDecision[] = [];
  const steps = script.steps ?? [];

  async function* run(request: AgentRequest): AsyncIterable<AgentMessage> {
    requests.push(request);

    for (const [index, step] of steps.entries()) {
      if (script.throwAfter !== undefined && index >= script.throwAfter) {
        throw script.error ?? new Error("fake agent failed");
      }

      const toolUseId = step.toolUseId ?? `tool_use_${index + 1}`;
      attempted.push(step.name);

      const decision = await request.canUseTool(step.name, step.input, {
        toolUseId,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      decisions.push(decision);
      await step.onDecision?.(decision);

      if (decision.behavior === "deny") {
        // The SDK hands the refusal to the model as the tool's result and
        // keeps going; so does the fake.
        yield {
          type: "tool_result",
          toolUseId,
          text: decision.message,
          isError: true,
          stdout: null,
          exitCode: null,
        };
        continue;
      }

      const outcome = step.outcome ?? {};
      yield {
        type: "tool_result",
        toolUseId,
        text: outcome.text ?? "ok",
        isError: outcome.isError ?? false,
        stdout: outcome.stdout ?? null,
        exitCode: outcome.exitCode ?? null,
      };
    }

    if (script.throwAfter !== undefined && steps.length >= script.throwAfter) {
      throw script.error ?? new Error("fake agent failed");
    }

    if (script.result === null) return;

    const result = script.result ?? {};
    yield {
      type: "result",
      ok: result.ok ?? true,
      usage: { ...emptyUsage(), ...result.usage },
      errorMessage: result.errorMessage ?? null,
    };
  }

  return { run, requests, attempted, decisions };
}
