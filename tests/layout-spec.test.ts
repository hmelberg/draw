import { describe, expect, test } from "vitest";
import { layoutSpec } from "../src/layout/layout";
import { flattenDrawables } from "../src/layout/model";

describe("layoutSpec", () => {
  test("templated spec produces scene drawables plus placed labels", () => {
    const r = layoutSpec({ template: "supply_demand", params: {}, commands: [{ draw: ["axes"] }] });
    expect(r.order).toContain("axes");
    expect(r.order).toContain("demand_curve");
    const flat = flattenDrawables(r.drawables);
    const labelD = flat.find((d) => d.id === "label_D");
    expect(labelD?.kind).toBe("text");
  });

  test("unknown template falls through to tier-2 with a warning", () => {
    const r = layoutSpec({
      template: "does_not_exist",
      elements: [{ id: "c", type: "curve", direction: "decreasing" }],
      commands: [{ draw: ["c"] }],
    });
    expect(r.warnings.join(" ")).toMatch(/does_not_exist/);
    expect(r.order).toContain("c");
  });

  test("stub template falls through gracefully", () => {
    const r = layoutSpec({
      template: "markov_model",
      elements: [{ id: "healthy", type: "node", shape: "circle", text: "Healthy" }],
      commands: [{ draw: ["healthy"] }],
    });
    expect(r.warnings.join(" ")).toMatch(/stub/i);
    expect(r.order).toContain("healthy");
  });

  test("extra elements can attach labels to scene-produced ids", () => {
    const r = layoutSpec({
      template: "supply_demand",
      params: {},
      elements: [{ id: "note", type: "label", text: "Market clears here", attach_to: "equilibrium_point" }],
      commands: [{ draw: ["axes"] }],
    });
    const note = flattenDrawables(r.drawables).find((d) => d.id === "note");
    expect(note?.kind).toBe("text");
    // attached near the equilibrium, not dumped at canvas center fallback
    expect(r.warnings.join(" ")).not.toMatch(/unknown attach_to/);
  });

  test("default supply/demand layout is lint-clean", () => {
    const r = layoutSpec({ template: "supply_demand", params: {}, commands: [] });
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});
