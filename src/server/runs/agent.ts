/**
 * The agent seam (specs/09-ai-run.md "Runner", docs/09-ai-run.md "The
 * library").
 *
 * A run is driven by the Claude Agent SDK, but the runner does not talk to
 * the SDK directly: it talks to an {@link Agent}, which yields a small,
 * normalized stream of messages and calls back for permission before each
 * tool executes. Two implementations exist — the real one over
 * `@anthropic-ai/claude-agent-sdk` (./sdkAgent.ts) and a scripted one
 * (./fakeAgent.ts) that lets tests drive whole transcripts, including the
 * approval loop, with no model, no network, and no credentials.
 *
 * The seam is deliberately narrow. Everything the run record needs — which
 * tool wants to run, what happened when it ran, and what the whole thing
 * cost — crosses it; nothing else does.
 */

import type { RunUsage } from "../../shared/runs.js";

/** What the agent tells the permission callback about one tool call. */
export interface AgentPermissionContext {
  /**
   * The SDK's id for this tool call. It reappears on the matching tool
   * result, which is how the runner ties an operation record to its
   * outcome.
   */
  toolUseId: string;
  /** Aborted when the run is torn down while a decision is outstanding. */
  signal?: AbortSignal;
}

/**
 * The answer the runner gives the agent. `deny` is not an error: the message
 * goes back to the model as the tool's result and the run continues
 * (docs/10 §3 "A denied operation does not stop the run").
 */
export type AgentPermissionDecision =
  | { behavior: "allow"; updatedInput?: Record<string, unknown> }
  | { behavior: "deny"; message: string };

export type AgentPermissionHandler = (
  toolName: string,
  input: Record<string, unknown>,
  context: AgentPermissionContext,
) => Promise<AgentPermissionDecision>;

/** One tool call's outcome, as the run log records it. */
export interface AgentToolResultMessage {
  type: "tool_result";
  toolUseId: string;
  /** The text the model receives. Used as `stdout` when nothing better exists. */
  text: string;
  isError: boolean;
  /** bash only; null when the agent reported no separate stdout. */
  stdout: string | null;
  /** bash only; null when the agent did not report one. Never invented. */
  exitCode: number | null;
}

/** The end of the agent's turn, carrying what it cost (docs/09 "Records"). */
export interface AgentResultMessage {
  type: "result";
  ok: boolean;
  usage: RunUsage;
  /** Why the agent ended unsuccessfully; null when it succeeded. */
  errorMessage: string | null;
}

export type AgentMessage = AgentToolResultMessage | AgentResultMessage;

/** One execution of one task (specs/09 "Runner"). */
export interface AgentRequest {
  /** The brief handed to the model. */
  prompt: string;
  /** The project's `workspacePath`; every path is confined to it (docs/10 §2). */
  cwd: string;
  /** The routed model, or null to let the SDK pick its default. */
  model: string | null;
  canUseTool: AgentPermissionHandler;
  signal?: AbortSignal;
}

export interface Agent {
  run(request: AgentRequest): AsyncIterable<AgentMessage>;
}

/** Zero usage — the starting point, and what a crashed agent reports. */
export function emptyUsage(): RunUsage {
  return { inputTokens: 0, outputTokens: 0, costUsd: 0 };
}
