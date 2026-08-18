// Prompt assembly. Prompts are data (src/llm/prompts/*.md) with placeholders;
// exemplars are runtime data (Loop 2). Everything here is pure and tested.

import type { Spec } from "../spec/types";

export interface PromptParts {
  schema: object;
  catalog: string;
  fewshots: string;
  exemplars: string;
}

export function buildSystemPrompt(variantSource: string, parts: PromptParts): string {
  return variantSource
    .replaceAll("{{SCHEMA}}", JSON.stringify(parts.schema, null, 2))
    .replaceAll("{{CATALOG}}", parts.catalog)
    .replaceAll("{{FEWSHOTS}}", parts.fewshots)
    .replaceAll("{{EXEMPLARS}}", parts.exemplars);
}

export interface Exemplar {
  prompt: string;
  spec: Spec;
}

const STOPWORDS = new Set([
  "draw", "the", "a", "an", "and", "with", "for", "of", "to", "in", "as", "show",
  "make", "create", "illustrate", "diagram", "figure", "me", "please", "that", "this",
]);

function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-zà-öø-ÿ0-9]+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

/** Keyword-overlap similarity; returns the n most similar exemplars (score > 0). */
export function selectExemplars<T extends Exemplar>(prompt: string, pool: T[], n: number): T[] {
  const target = keywords(prompt);
  const scored = pool
    .map((ex, i) => {
      const kw = keywords(ex.prompt);
      let overlap = 0;
      for (const w of kw) if (target.has(w)) overlap++;
      const denom = Math.sqrt(kw.size * target.size) || 1;
      return { ex, i, score: overlap / denom, overlap };
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, n).map((s) => s.ex);
}

export function formatExemplars(exemplars: Exemplar[]): string {
  if (exemplars.length === 0) return "(none yet)";
  return exemplars
    .map((ex, i) => `### Exemplar ${i + 1}\nRequest: ${ex.prompt}\nSpec:\n\`\`\`json\n${JSON.stringify(ex.spec, null, 1)}\n\`\`\``)
    .join("\n\n");
}
