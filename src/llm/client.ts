// Browser-side Anthropic client (BYOK). The key lives in localStorage only and
// leaves the browser solely in requests to api.anthropic.com — the SDK's
// dangerouslyAllowBrowser + the anthropic-dangerous-direct-browser-access
// header are Anthropic's supported CORS mechanism for exactly this pattern.

import Anthropic from "@anthropic-ai/sdk";

export const MODELS = [
  { id: "claude-opus-5", label: "Claude Opus 5 (default)" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
] as const;

export const DEFAULT_MODEL = "claude-opus-5";

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
  });
}

export class RefusalError extends Error {
  constructor(explanation: string | undefined) {
    super(explanation ?? "The model declined this request (safety refusal).");
    this.name = "RefusalError";
  }
}

export interface JsonCallMeta {
  ms: number;
  servedBy?: string;
  structuredOutput: boolean;
  inputTokens?: number;
  outputTokens?: number;
}

function opusTier(model: string): boolean {
  return model.startsWith("claude-opus-5") || model.startsWith("claude-fable");
}

async function createMessage(
  client: Anthropic,
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
  outputSchema: object | null,
  useFallbacks: boolean,
): Promise<Anthropic.Message> {
  const base = {
    model,
    max_tokens: 16000,
    system,
    messages,
    ...(outputSchema
      ? { output_config: { format: { type: "json_schema" as const, schema: outputSchema as Record<string, unknown> } } }
      : {}),
  };
  if (useFallbacks && opusTier(model)) {
    // Server-side refusal fallbacks, scalar "default" form (routes by refusal
    // category). Enabled by default for the Opus-5 tier; a 400 falls back to a
    // plain request below.
    return (await client.beta.messages.create({
      ...base,
      betas: ["server-side-fallback-2026-07-01"],
      ...({ fallbacks: "default" } as object),
    })) as unknown as Anthropic.Message;
  }
  return client.messages.create(base);
}

/** One JSON-producing call: structured output first, plain-JSON fallback on 400. */
export async function callForJson(
  client: Anthropic,
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
  outputSchema: object,
): Promise<{ json: unknown; raw: string; meta: JsonCallMeta }> {
  const t0 = performance.now();
  let response: Anthropic.Message | null = null;
  let structured = true;

  const attempts: { schema: object | null; fallbacks: boolean }[] = [
    { schema: outputSchema, fallbacks: true },
    { schema: outputSchema, fallbacks: false },
    { schema: null, fallbacks: false },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      response = await createMessage(client, model, system, messages, attempt.schema, attempt.fallbacks);
      structured = attempt.schema !== null;
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Anthropic.BadRequestError) continue; // degrade and retry
      throw err;
    }
  }
  if (!response) throw lastError;

  if (response.stop_reason === "refusal") {
    const details = (response as unknown as { stop_details?: { explanation?: string } }).stop_details;
    throw new RefusalError(details?.explanation);
  }

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const json = structured ? JSON.parse(raw) : extractJson(raw);

  return {
    json,
    raw,
    meta: {
      ms: performance.now() - t0,
      servedBy: response.model !== model ? response.model : undefined,
      structuredOutput: structured,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    },
  };
}

/** Plain text call (used by the raw-SVG baseline). */
export async function callForText(
  client: Anthropic,
  model: string,
  system: string,
  messages: Anthropic.MessageParam[],
): Promise<{ text: string; ms: number }> {
  const t0 = performance.now();
  const response = await createMessage(client, model, system, messages, null, true).catch((err) => {
    if (err instanceof Anthropic.BadRequestError) return createMessage(client, model, system, messages, null, false);
    throw err;
  });
  if (response.stop_reason === "refusal") {
    const details = (response as unknown as { stop_details?: { explanation?: string } }).stop_details;
    throw new RefusalError(details?.explanation);
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, ms: performance.now() - t0 };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in the response");
  // scan for the matching closing brace
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (escape) {
      escape = false;
    } else if (c === "\\") {
      escape = true;
    } else if (c === '"') {
      inString = !inString;
    } else if (!inString) {
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error("unbalanced JSON in the response");
}

/** Human-readable message for the UI. */
export function describeApiError(err: unknown): string {
  if (err instanceof RefusalError) return `Refused: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return "Invalid API key (401). Check Settings.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited (429). Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `Bad request (400): ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof Error && /fetch|network/i.test(err.message)) return "Network error — check your connection (or CORS).";
  return err instanceof Error ? err.message : String(err);
}
