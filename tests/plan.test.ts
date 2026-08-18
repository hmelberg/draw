import { describe, expect, test } from "vitest";
import { planCommands } from "../src/render/plan";

const allIds = ["axes", "demand_curve", "label_D", "supply_curve"];

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

  test("cumulative drawn sets support command-level step back", () => {
    const { drawnUpTo } = planCommands(
      [{ speak: "intro" }, { draw: ["axes"] }, { pause: 1 }, { draw: ["demand_curve", "label_D"] }],
      allIds,
    );
    expect(drawnUpTo[0]).toEqual([]);
    expect(drawnUpTo[1]).toEqual(["axes"]);
    expect(drawnUpTo[2]).toEqual(["axes"]);
    expect(drawnUpTo[3].sort()).toEqual(["axes", "demand_curve", "label_D"]);
  });

  test("speak and pause pass through with their payloads", () => {
    const { steps } = planCommands([{ speak: "hello" }, { pause: 2.5 }], []);
    expect(steps[0]).toMatchObject({ kind: "speak", text: "hello" });
    expect(steps[1]).toMatchObject({ kind: "pause", seconds: 2.5 });
  });

  test("parallel flag is preserved on draw steps", () => {
    const { steps } = planCommands([{ draw: ["axes", "demand_curve"], parallel: true }], allIds);
    expect(steps[0]).toMatchObject({ kind: "draw", parallel: true });
  });
});
