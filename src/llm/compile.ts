// The generation pipeline (Loop 1): call → schema validation → visual lint,
// with capped repair rounds fed back to the LLM. Every round is logged.
// The vision critic (Loop 1.3) hooks in here when built — see ROADMAP.

import type Anthropic from "@anthropic-ai/sdk";
import { makeClient, callForJson, describeApiError, type JsonCallMeta } from "./client";
import { buildSystemPrompt, formatExemplars, selectExemplars, type Exemplar } from "./prompt";
import { sceneCatalogText } from "../scenes/registry";
import { specSchema, validateSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { layoutSpec } from "../layout/layout";
import { lintReportText, type LintIssue } from "../lint/lint";
import { makeBrowserMeasure } from "../render/svg-backend";
import fewshots from "./prompts/fewshots.json";

export interface PromptVariant {
  name: string;
  source: string;
}

const variantModules = import.meta.glob("./prompts/compiler-*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export function promptVariants(): PromptVariant[] {
  return Object.entries(variantModules)
    .map(([path, source]) => ({
      name: path.replace(/^.*compiler-/, "").replace(/\.md$/, ""),
      source,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fewshotsText(): string {
  return (fewshots as { request: string; spec: unknown }[])
    .map((ex, i) => `### Example ${i + 1}\nRequest: ${ex.request}\nSpec:\n\`\`\`json\n${JSON.stringify(ex.spec, null, 1)}\n\`\`\``)
    .join("\n\n");
}

/** Schema copy for the API's structured-output constraint. */
function apiSchema(): object {
  const copy = JSON.parse(JSON.stringify(specSchema)) as Record<string, unknown>;
  delete copy.$schema;
  return copy;
}

export interface GenerationRound {
  label: "initial" | "schema-repair" | "lint-repair";
  spec: unknown;
  validationErrors: string[];
  lintIssues: LintIssue[];
  meta: JsonCallMeta;
}

export interface GenerationOutcome {
  spec: Spec | null;
  rounds: GenerationRound[];
  /** Set when no usable spec was produced. */
  error?: string;
  systemPromptChars: number;
}

export interface GenerateConfig {
  apiKey: string;
  model: string;
  variant: PromptVariant;
  exemplars: Exemplar[];
  maxRepairs?: number;
}

export function assembleSystemPrompt(request: string, variant: PromptVariant, exemplarPool: Exemplar[]): string {
  return buildSystemPrompt(variant.source, {
    schema: apiSchema(),
    catalog: sceneCatalogText(),
    fewshots: fewshotsText(),
    exemplars: formatExemplars(selectExemplars(request, exemplarPool, 3)),
  });
}

export async function generateSpec(request: string, cfg: GenerateConfig): Promise<GenerationOutcome> {
  const client = makeClient(cfg.apiKey);
  const system = assembleSystemPrompt(request, cfg.variant, cfg.exemplars);
  const schema = apiSchema();
  const measure = makeBrowserMeasure();
  const maxRepairs = cfg.maxRepairs ?? 2;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: request }];
  const rounds: GenerationRound[] = [];
  let best: Spec | null = null;
  let repairsUsed = 0;

  try {
    while (true) {
      const label: GenerationRound["label"] = rounds.length === 0 ? "initial" : rounds[rounds.length - 1].validationErrors.length > 0 ? "schema-repair" : "lint-repair";
      const { json, raw, meta } = await callForJson(client, cfg.model, system, messages, schema);
      const validation = validateSpec(json);
      let lintIssues: LintIssue[] = [];
      if (validation.ok) {
        best = json as Spec;
        try {
          lintIssues = layoutSpec(best, measure).issues;
        } catch (err) {
          lintIssues = [];
          validation.errors.push(`layout failed: ${(err as Error).message}`);
        }
      }
      rounds.push({ label, spec: json, validationErrors: validation.errors, lintIssues, meta });

      const needsRepair = validation.errors.length > 0 || lintIssues.length > 0;
      if (!needsRepair || repairsUsed >= maxRepairs) break;
      repairsUsed++;

      const feedback =
        validation.errors.length > 0
          ? `The spec failed validation:\n${validation.errors.join("\n")}\n\nReturn the corrected COMPLETE spec (not a diff).`
          : `The rendered figure has visual problems:\n${lintReportText(lintIssues)}\n\nReturn the corrected COMPLETE spec (not a diff). Typical fixes: different label sides, shorter texts, fewer overlapping elements.`;
      messages.push({ role: "assistant", content: raw }, { role: "user", content: feedback });
    }
  } catch (err) {
    return {
      spec: best,
      rounds,
      error: describeApiError(err),
      systemPromptChars: system.length,
    };
  }

  return {
    spec: best,
    rounds,
    error: best ? undefined : "The model never produced a valid spec (see rounds).",
    systemPromptChars: system.length,
  };
}
