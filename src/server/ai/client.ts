/**
 * Anthropic client module (specs/07-ai-compose.md, docs/09-ai-run.md
 * "Credentials").
 *
 * Credentials come from the environment only — `ANTHROPIC_API_KEY`,
 * `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile on disk — and the
 * SDK itself is responsible for resolving whichever is present. This module
 * never stores a key and never exposes a key field anywhere; `detectCredentials`
 * only checks whether a credential *appears* available so the rest of the
 * app can decide whether to attempt an AI call at all.
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ApiError } from "../errors.js";

/** Model used for every compose-side Messages API call (specs/07). */
export const DEFAULT_MODEL = "claude-opus-5";

const DEFAULT_MAX_TOKENS = 8192;

/**
 * Directory `ant auth login` stores profiles under. Mirrors the CLI's own
 * resolution: an explicit `ANTHROPIC_CONFIG_DIR` wins, otherwise it's
 * `%APPDATA%\Anthropic` on Windows and `~/.config/anthropic` elsewhere.
 */
function antConfigDir(): string {
  const explicit = process.env.ANTHROPIC_CONFIG_DIR;
  if (explicit) return explicit;
  if (process.platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "Anthropic");
  }
  return join(homedir(), ".config", "anthropic");
}

/** Whether an `ant auth login` credential file exists for the active profile. */
function hasAntAuthProfile(): boolean {
  const profile = process.env.ANTHROPIC_PROFILE || "default";
  const credentialsPath = join(antConfigDir(), "credentials", `${profile}.json`);
  try {
    return existsSync(credentialsPath);
  } catch {
    return false;
  }
}

/**
 * Whether the environment appears to hold a usable Anthropic credential.
 * Does not validate the credential — only that the SDK will have something
 * to try. Recomputed on every call so tests can flip env vars freely.
 */
export function aiAvailable(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;
  if (process.env.ANTHROPIC_AUTH_TOKEN) return true;
  return hasAntAuthProfile();
}

/** Logs the startup notice specs/07 requires when no credential is found. */
export function logCredentialStatus(logger: Pick<Console, "warn"> = console): void {
  if (!aiAvailable()) {
    logger.warn("no Anthropic credentials found");
  }
}

/** Throws the stable 503 AI endpoints must return while `aiAvailable()` is false. */
export function requireAiAvailable(): void {
  if (!aiAvailable()) {
    throw new ApiError("AI_UNAVAILABLE", 503, undefined, "No Anthropic credentials found");
  }
}

let cachedClient: Anthropic | undefined;

/** Lazily-constructed singleton — the SDK resolves credentials on first use. */
export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic();
  }
  return cachedClient;
}

/** Test-only: drop the cached client so a re-mocked SDK takes effect. */
export function resetAnthropicClientForTests(): void {
  cachedClient = undefined;
}

/**
 * Runs a single-turn structured extraction against the Messages API.
 *
 * Uses `messages.parse()` with `zodOutputFormat(schema)` so the response is
 * validated against `schema` and returned as `parsed_output`. The system
 * prompt is marked `cache_control: { type: "ephemeral" }` — per-project
 * prompts built from field definitions are stable across calls and are most
 * of the tokens (specs/07).
 *
 * Throws `503 AI_UNAVAILABLE` when no credential is available, and
 * `502 AI_PARSE_FAILED` when the model's response does not validate against
 * `schema`.
 */
export async function parse<Schema extends z.ZodType>(
  model: string,
  system: string,
  user: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  requireAiAvailable();
  const client = getAnthropicClient();

  const message = await client.messages.parse({
    model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema) },
  });

  if (message.parsed_output == null) {
    throw new ApiError(
      "AI_PARSE_FAILED",
      502,
      undefined,
      "Anthropic response did not match the expected schema",
    );
  }

  return message.parsed_output;
}
