/** Find and parse the first complete JSON object inside arbitrary text. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start === -1) throw new Error("no JSON object found in the text");
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
  throw new Error("unbalanced JSON in the text");
}

/**
 * Undo the damage word processors do to pasted JSON: curly quotes, non-breaking
 * spaces, BOM. (Google Docs autocorrects straight quotes to “smart” ones.)
 */
export function desmartenJson(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/ /g, " ");
}
