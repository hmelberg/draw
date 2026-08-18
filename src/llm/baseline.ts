// Backend 0 for honesty: what the LLM produces unaided — a raw SVG, no spec,
// no deterministic geometry, no lint. The experiment's success criterion is
// beating this.

import { makeClient, callForText } from "./client";

const BASELINE_SYSTEM = `You draw educational illustrations as a single standalone SVG.
Return ONLY the SVG markup (no prose, no code fences): one <svg> element with viewBox="0 0 1000 750".
Aim for a clear, attractive, fully labeled teaching figure. No <script>, no external references.`;

export interface BaselineResult {
  svg: string;
  ms: number;
}

export async function generateRawSvg(request: string, cfg: { apiKey: string; model: string }): Promise<BaselineResult> {
  const client = makeClient(cfg.apiKey);
  const { text, ms } = await callForText(client, cfg.model, BASELINE_SYSTEM, [{ role: "user", content: request }]);
  const match = /<svg[\s\S]*<\/svg>/i.exec(text);
  if (!match) throw new Error("the model did not return an <svg> element");
  return { svg: sanitizeSvg(match[0]), ms };
}

/** Strip active content before injecting model-written SVG into the page. */
export function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName === "parsererror" || root.querySelector("parsererror")) {
    throw new Error("the model returned malformed SVG");
  }
  for (const el of Array.from(root.querySelectorAll("script, foreignObject, iframe, animate, set"))) {
    el.remove();
  }
  const walk = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "xlink:href") && !value.startsWith("#"))) {
        el.removeAttribute(attr.name);
      }
    }
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  return new XMLSerializer().serializeToString(root);
}
