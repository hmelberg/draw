import { describe, expect, test } from "vitest";
import { planCommands, type PlanStep } from "../src/render/plan";
import { CANVAS } from "../src/layout/canvas";

const allIds = ["axes", "demand_curve", "label_D", "supply_curve"];

/** visible ids after steps[0..i] */
const visibleAt = (plan: ReturnType<typeof planCommands>, i: number) => plan.states[i].visible;

describe("planCommands", () => {
  test("normalizes a bare-string draw into an id list", () => {
    const { steps } = planCommands([{ draw: "axes" }], allIds);
    expect(steps[0]).toMatchObject({ kind: "draw", ids: ["axes"] });
  });

  test("appends an implicit final draw for unmentioned elements", () => {
    const { steps } = planCommands([{ draw: ["axes"] }], allIds);
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("draw");
    expect((last as { ids: string[] }).ids.sort()).toEqual(["demand_curve", "label_D", "supply_curve"]);
  });

  test("drops unknown ids with a warning instead of failing", () => {
    const { steps, warnings } = planCommands([{ draw: ["axes", "nonsense"] }], allIds);
    expect((steps[0] as { ids: string[] }).ids).toEqual(["axes"]);
    expect(warnings.join(" ")).toMatch(/nonsense/);
  });

  test("no commands means one draw-everything step", () => {
    const { steps } = planCommands(undefined, allIds);
    expect(steps).toHaveLength(1);
    expect((steps[0] as { ids: string[] }).ids.sort()).toEqual([...allIds].sort());
  });

  test("cumulative scene states support command-level step back", () => {
    const plan = planCommands(
      [{ speak: "intro" }, { draw: ["axes"] }, { pause: 1 }, { draw: ["demand_curve", "label_D"] }],
      allIds,
    );
    expect(visibleAt(plan, 0)).toEqual([]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
    expect(visibleAt(plan, 2)).toEqual(["axes"]);
    expect([...visibleAt(plan, 3)].sort()).toEqual(["axes", "demand_curve", "label_D"]);
  });

  test("speak and pause pass through with their payloads", () => {
    const { steps } = planCommands([{ speak: "hello" }, { pause: 2.5 }], []);
    expect(steps[0]).toMatchObject({ kind: "speak", text: "hello", blocking: true });
    expect(steps[1]).toMatchObject({ kind: "pause", seconds: 2.5 });
  });

  test("speak blocking:false is preserved", () => {
    const { steps } = planCommands([{ speak: "watch this", blocking: false }], []);
    expect(steps[0]).toMatchObject({ kind: "speak", blocking: false });
  });

  test("parallel flag is preserved on draw steps", () => {
    const { steps } = planCommands([{ draw: ["axes", "demand_curve"], parallel: true }], allIds);
    expect(steps[0]).toMatchObject({ kind: "draw", parallel: true });
  });
});

describe("visibility verbs", () => {
  test("hide removes ids from the visible state; show restores them", () => {
    const plan = planCommands(
      [{ draw: ["axes", "demand_curve"] }, { hide: ["demand_curve"] }, { show: ["demand_curve"] }],
      ["axes", "demand_curve"],
    );
    expect(visibleAt(plan, 0).sort()).toEqual(["axes", "demand_curve"]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
    expect(visibleAt(plan, 2).sort()).toEqual(["axes", "demand_curve"]);
  });

  test("erase produces an animatable step only for visible ids", () => {
    const plan = planCommands(
      [{ draw: ["axes"] }, { erase: ["axes", "demand_curve"] }],
      ["axes", "demand_curve"],
    );
    const eraseStep = plan.steps.find((s) => s.kind === "erase") as Extract<PlanStep, { kind: "erase" }>;
    expect(eraseStep.ids).toEqual(["axes"]);
    expect(visibleAt(plan, plan.steps.indexOf(eraseStep))).toEqual([]);
  });

  test("hidden/erased elements are excluded from the implicit final draw", () => {
    const plan = planCommands([{ draw: ["axes"] }, { hide: ["demand_curve"] }], ["axes", "demand_curve", "label_D"]);
    const last = plan.steps[plan.steps.length - 1] as Extract<PlanStep, { kind: "draw" }>;
    expect(last.implicit).toBe(true);
    expect(last.ids).toEqual(["label_D"]);
  });

  test("clear hides everything visible except keep", () => {
    const plan = planCommands(
      [{ draw: ["axes", "demand_curve", "label_D"] }, { clear: { keep: ["axes"] } }],
      ["axes", "demand_curve", "label_D"],
    );
    const clearStep = plan.steps[1] as Extract<PlanStep, { kind: "clear" }>;
    expect(clearStep.ids.sort()).toEqual(["demand_curve", "label_D"]);
    expect(visibleAt(plan, 1)).toEqual(["axes"]);
  });
});

describe("move", () => {
  test("accumulates offsets across moves and converts domain deltas", () => {
    const plan = planCommands(
      [{ draw: ["demand_curve"] }, { move: { target: ["demand_curve"], by: [10, 0] } }, { move: { target: "demand_curve", by: [5, 2] } }],
      ["demand_curve"],
      { deltaToLogical: ([x, y]) => [x * 2, y * 3] },
    );
    expect(plan.states[1].offsets["demand_curve"]).toEqual([20, 0]);
    expect(plan.states[2].offsets["demand_curve"]).toEqual([30, 6]);
    expect(plan.steps[2]).toMatchObject({ kind: "move", path: [[10, 6]], easing: "ease-in-out", seconds: 1 });
  });

  test("move of an invisible element warns but still applies", () => {
    const plan = planCommands([{ move: { target: ["axes"], by: [5, 0] } }], ["axes"]);
    expect(plan.warnings.join(" ")).toMatch(/not visible/);
    expect(plan.states[0].offsets["axes"]).toEqual([5, 0]);
  });

  test("move without by/path is skipped with a warning", () => {
    const plan = planCommands([{ move: { target: ["axes"] } }], ["axes"]);
    expect(plan.warnings.join(" ")).toMatch(/by\/path/);
    expect(plan.steps.filter((s) => s.kind === "move")).toHaveLength(0);
  });
});

describe("highlight and point", () => {
  const bboxOf = (id: string) => (id === "eq" ? { x: 100, y: 200, w: 40, h: 20 } : null);

  test("highlight targets only visible elements and carries their boxes", () => {
    const plan = planCommands(
      [{ draw: ["eq"] }, { highlight: { target: ["eq", "ghost"], effect: "circle", duration: 2 } }],
      ["eq", "ghost"],
      { bboxOf },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "highlight" }>;
    expect(step).toMatchObject({ kind: "highlight", ids: ["eq"], effect: "circle", seconds: 2 });
    expect(step.boxes["eq"]).toEqual({ x: 100, y: 200, w: 40, h: 20 });
    expect(plan.warnings.join(" ")).toMatch(/ghost/);
  });

  test("point at a ref resolves to the element's bbox center", () => {
    const plan = planCommands([{ draw: ["eq"] }, { point: { at: { ref: "eq" } } }], ["eq"], { bboxOf });
    const step = plan.steps[1] as Extract<PlanStep, { kind: "point" }>;
    expect(step).toMatchObject({ kind: "point", x: 120, y: 210, gesture: "tap", seconds: 2 });
  });

  test("point at coordinates maps through the domain", () => {
    const plan = planCommands([{ point: { at: { x: 1, y: 2 }, gesture: "underline" } }], [], {
      toLogical: ([x, y]) => [x * 100, y * 100],
    });
    expect(plan.steps[0]).toMatchObject({ kind: "point", x: 100, y: 200, gesture: "underline" });
  });

  test("point at an unknown ref is skipped with a warning", () => {
    const plan = planCommands([{ point: { at: { ref: "nope" } } }], ["eq"], { bboxOf });
    expect(plan.steps.filter((s) => s.kind === "point")).toHaveLength(0);
    expect(plan.warnings.join(" ")).toMatch(/nope/);
  });
});

describe("camera", () => {
  test("zoom on an element yields a clamped canvas-aspect box", () => {
    const plan = planCommands(
      [{ draw: ["eq"] }, { camera: { center: { ref: "eq" }, zoom: 2 } }],
      ["eq"],
      { bboxOf: () => ({ x: 0, y: 0, w: 40, h: 20 }) },
    );
    const step = plan.steps[1] as Extract<PlanStep, { kind: "camera" }>;
    expect(step.box).toEqual({ x: 0, y: 0, w: CANVAS.w / 2, h: CANVAS.h / 2 }); // clamped to the bottom-left corner
    expect(plan.states[1].camera).toEqual(step.box);
  });

  test("reset returns the camera state to null", () => {
    const plan = planCommands([{ camera: { zoom: 2 } }, { camera: { reset: true } }], []);
    expect(plan.states[0].camera).not.toBeNull();
    expect(plan.states[1].camera).toBeNull();
  });
});
