import { describe, expect, test } from "vitest";
import { buildSystemPrompt, selectExemplars } from "../src/llm/prompt";

describe("buildSystemPrompt", () => {
  test("substitutes schema, catalog, fewshot, and exemplar placeholders", () => {
    const out = buildSystemPrompt("Rules.\n{{SCHEMA}}\n{{CATALOG}}\n{{FEWSHOTS}}\n{{EXEMPLARS}}", {
      schema: { type: "object" },
      catalog: "SCENE CATALOG HERE",
      fewshots: "FEWSHOTS HERE",
      exemplars: "EXEMPLARS HERE",
    });
    expect(out).toContain('"type": "object"');
    expect(out).toContain("SCENE CATALOG HERE");
    expect(out).toContain("FEWSHOTS HERE");
    expect(out).toContain("EXEMPLARS HERE");
    expect(out).not.toMatch(/\{\{[A-Z]+\}\}/);
  });
});

describe("selectExemplars", () => {
  const pool = [
    { prompt: "Draw a demand and supply diagram", spec: { commands: [] } },
    { prompt: "Draw a supply curve shifting right", spec: { commands: [] } },
    { prompt: "Show herd immunity as a network", spec: { commands: [] } },
  ];

  test("ranks by keyword overlap with the request", () => {
    const picked = selectExemplars("draw a supply and demand diagram with equilibrium", pool, 2);
    expect(picked[0].prompt).toMatch(/demand and supply/);
    expect(picked).toHaveLength(2);
  });

  test("returns empty for an empty pool", () => {
    expect(selectExemplars("anything", [], 3)).toEqual([]);
  });

  test("ignores exemplars with no overlap at all", () => {
    const picked = selectExemplars("xylophone quantum zebra", pool, 3);
    expect(picked).toEqual([]);
  });
});
