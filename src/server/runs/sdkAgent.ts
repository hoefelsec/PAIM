/**
 * The real {@link Agent}: `@anthropic-ai/claude-agent-sdk` (docs/09-ai-run.md
 * "The library" — "the Agent SDK is Claude Code as a library").
 *
 * This module is an adapter and nothing else. It configures the SDK the way
 * docs/09 and docs/10 require, and translates in both directions:
 *
 * - the six built-in tools and no others (docs/09 "The library");
 * - `cwd` is the project's workspace path, and no additional directories
 *   are granted, so the SDK's own path handling agrees with the runner's
 *   confinement (docs/10 §2);
 * - `settingSources: []` — a `.claude/settings.json` in the workspace must
 *   not be able to widen what a run may do; the project's safety policy is
 *   the boundary (docs/10 §4);
 * - `canUseTool` is delegated straight to the runner, which is where the
 *   deny list, the mode, and the approval parking live.
 *
 * Credentials are the SDK's business: it reads them from the environment,
 * and PAIM never stores or forwards a key (docs/09 "Credentials").
 */

import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { RunUsage } from "../../shared/runs.js";
import {
  emptyUsage,
  type Agent,
  type AgentMessage,
  type AgentRequest,
  type AgentToolResultMessage,
} from "./agent.js";
import { RUN_TOOL_NAMES } from "./tools.js";

/** Reads a field off an unknown structured payload without trusting it. */
function field(source: unknown, name: string): unknown {
  if (typeof source !== "object" || source === null) return undefined;
  return (source as Record<string, unknown>)[name];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Flattens whatever the SDK put in a `tool_result` block's `content` into
 * the one string the run log shows.
 */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (field(block, "type") === "text" ? stringOrNull(field(block, "text")) : null))
    .filter((text): text is string => text !== null)
    .join("\n");
}

/**
 * Tokens and cost for the run (docs/09 "Records": usage comes from the SDK
 * result messages). `modelUsage` is the SDK's documented field for token and
 * cost accounting — it covers subagent and internal calls, which the
 * main-loop `usage` field does not — so it is summed across models, with
 * the main-loop numbers as the fallback when it is empty.
 */
export function usageFromResult(message: {
  usage?: { input_tokens?: number; output_tokens?: number };
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number }>;
  total_cost_usd?: number;
}): RunUsage {
  const perModel = Object.values(message.modelUsage ?? {});
  const usage = emptyUsage();

  if (perModel.length > 0) {
    for (const entry of perModel) {
      usage.inputTokens += entry.inputTokens ?? 0;
      usage.outputTokens += entry.outputTokens ?? 0;
    }
  } else {
    usage.inputTokens = message.usage?.input_tokens ?? 0;
    usage.outputTokens = message.usage?.output_tokens ?? 0;
  }

  usage.costUsd = message.total_cost_usd ?? 0;
  return usage;
}

/**
 * Every `tool_result` block carried by one SDK message. A single user
 * message can carry several when the model called tools in parallel.
 */
function toolResults(message: SDKMessage): AgentToolResultMessage[] {
  if (message.type !== "user") return [];
  const content = field(field(message, "message"), "content");
  if (!Array.isArray(content)) return [];

  const structured = field(message, "tool_use_result");

  return content
    .filter((block) => field(block, "type") === "tool_result")
    .map((block) => {
      const toolUseId = stringOrNull(field(block, "tool_use_id"));
      if (toolUseId === null) return null;
      // Bash reports stdout separately in its structured output; every
      // other tool has only the text the model reads. The exit code is
      // recorded only when the payload actually carries one — an unknown
      // code stays null rather than being invented (docs/09 "Records").
      const stdout = stringOrNull(field(structured, "stdout"));
      const exitCode =
        numberOrNull(field(structured, "exitCode")) ?? numberOrNull(field(structured, "returnCode"));
      const result: AgentToolResultMessage = {
        type: "tool_result",
        toolUseId,
        text: resultText(field(block, "content")),
        isError: field(block, "is_error") === true,
        stdout,
        exitCode,
      };
      return result;
    })
    .filter((result): result is AgentToolResultMessage => result !== null);
}

/** The Agent SDK, behind the runner's seam. */
export function createSdkAgent(): Agent {
  return {
    async *run(request: AgentRequest): AsyncIterable<AgentMessage> {
      const abortController = new AbortController();
      const onAbort = (): void => abortController.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) abortController.abort();

      const options: Options = {
        cwd: request.cwd,
        tools: [...RUN_TOOL_NAMES],
        settingSources: [],
        permissionMode: "default",
        abortController,
        canUseTool: async (toolName, input, context) => {
          const decision = await request.canUseTool(toolName, input, {
            toolUseId: context.toolUseID,
            signal: context.signal,
          });
          if (decision.behavior === "allow") {
            return decision.updatedInput
              ? { behavior: "allow", updatedInput: decision.updatedInput }
              : { behavior: "allow" };
          }
          return { behavior: "deny", message: decision.message };
        },
        ...(request.model ? { model: request.model } : {}),
      };

      try {
        for await (const message of query({ prompt: request.prompt, options })) {
          if (message.type === "user") {
            yield* toolResults(message);
            continue;
          }
          if (message.type === "result") {
            yield {
              type: "result",
              ok: message.subtype === "success" && !message.is_error,
              usage: usageFromResult(message),
              errorMessage:
                message.subtype === "success" ? null : (message.errors?.[0] ?? message.subtype),
            };
          }
        }
      } finally {
        request.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
