import { describe, expect, test } from "vitest";
import { validateSpec } from "../src/spec/schema";
import type { Spec } from "../src/spec/types";

const goodSpec: Spec = {
  template: "supply_demand",
  params: { demand: { label: "D" }, supply: { label: "S" }, equilibrium: { show: true } },
  commands: [
    { speak: "Start with the axes." },
    { draw: ["axes"] },
    { draw: ["demand_curve", "label_D"] },
    { pause: 1 },
  ],
};

describe("validateSpec", () => {
  test("accepts a valid templated spec", () => {
    const r = validateSpec(goodSpec);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test("accepts a draw command given as a bare string", () => {
    const r = validateSpec({ template: "supply_demand", commands: [{ draw: "axes" }] });
    expect(r.ok).toBe(true);
  });

  test("rejects a command mixing speak and draw", () => {
    const r = validateSpec({ commands: [{ speak: "hi", draw: ["axes"] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/exactly one/i);
  });

  test("rejects a command with none of speak/draw/pause", () => {
    const r = validateSpec({ commands: [{ parallel: true }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a curve element with neither qualitative shape nor expr", () => {
    const r = validateSpec({
      elements: [{ id: "c1", type: "curve" }],
      commands: [{ draw: ["c1"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/c1/);
  });

  test("rejects duplicate element ids", () => {
    const r = validateSpec({
      elements: [
        { id: "a", type: "text", text: "x", x: 10, y: 10 },
        { id: "a", type: "text", text: "y", x: 20, y: 20 },
      ],
      commands: [{ draw: ["a"] }],
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/duplicate/i);
  });

  test("rejects a label without attach_to", () => {
    const r = validateSpec({
      elements: [{ id: "l1", type: "label", text: "hello" }],
      commands: [{ draw: ["l1"] }],
    });
    expect(r.ok).toBe(false);
  });

  test("reports structural (ajv) errors for wrong types", () => {
    const r = validateSpec({ commands: [{ pause: "long" }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a spec with neither template nor elements", () => {
    const r = validateSpec({ commands: [{ speak: "nothing to draw" }] });
    expect(r.ok).toBe(false);
  });
});

describe("validateSpec — gesture verbs", () => {
  const base = { template: "supply_demand" };

  test("accepts every new verb in valid form", () => {
    const r = validateSpec({
      ...base,
      commands: [
        { speak: "look here", blocking: false },
        { point: { at: { ref: "eq" }, gesture: "circle" } },
        { highlight: { target: ["demand_curve"], effect: "pulse", duration: 2, color: "#c00" } },
        { move: { target: ["demand_curve"], by: [10, 0], easing: "ease-out" } },
        { move: { target: ["dot"], path: [[5, 5], [10, 0]] } },
        { show: ["guides"] },
        { hide: ["guides"] },
        { erase: ["note"], parallel: true },
        { clear: { keep: ["axes"] } },
        { camera: { center: { ref: "eq" }, zoom: 2 } },
        { camera: { reset: true } },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test("accepts bare-string targets on the new verbs", () => {
    const r = validateSpec({
      ...base,
      commands: [{ hide: "guides" }, { highlight: { target: "demand_curve" } }, { move: { target: "dot", by: [1, 1] } }],
    });
    expect(r.ok).toBe(true);
  });

  test("rejects two verbs on one command", () => {
    const r = validateSpec({ ...base, commands: [{ hide: ["a"], show: ["b"] }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/exactly one/i);
  });

  test("rejects blocking on a non-speak command", () => {
    const r = validateSpec({ ...base, commands: [{ draw: ["axes"], blocking: false }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/blocking/);
  });

  test("rejects a move without by or path", () => {
    const r = validateSpec({ ...base, commands: [{ move: { target: ["a"] } }] });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/by|path/);
  });

  test("rejects a point without a resolvable at", () => {
    const r = validateSpec({ ...base, commands: [{ point: { at: { x: 5 } } }] });
    expect(r.ok).toBe(false);
  });

  test("rejects a camera with no center/zoom/reset", () => {
    const r = validateSpec({ ...base, commands: [{ camera: {} }] });
    expect(r.ok).toBe(false);
  });
});
