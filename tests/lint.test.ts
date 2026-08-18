import { describe, expect, test } from "vitest";
import { lintLayout } from "../src/lint/lint";
import { heuristicMeasure } from "../src/layout/measure";
import { defaultStyle, defaultDrawOpts, type Drawable } from "../src/layout/model";

function text(id: string, pos: [number, number], fontSize = 24, str = "Some label"): Drawable {
  return { id, kind: "text", pos, text: str, fontSize, anchor: "middle", z: 2, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") };
}

function stroke(id: string, pts: [number, number][]): Drawable {
  return { id, kind: "stroke", pts, z: 1, style: defaultStyle(), drawOpts: defaultDrawOpts("sketch") };
}

describe("lintLayout", () => {
  test("clean layout has no issues", () => {
    const issues = lintLayout([text("a", [200, 200]), text("b", [700, 600])], heuristicMeasure);
    expect(issues).toEqual([]);
  });

  test("flags overlapping labels", () => {
    const issues = lintLayout([text("a", [500, 400]), text("b", [510, 405])], heuristicMeasure);
    const overlap = issues.find((i) => i.rule === "overlap-label-label");
    expect(overlap).toBeDefined();
    expect(overlap!.ids.sort()).toEqual(["a", "b"]);
  });

  test("flags a label sitting on a stroke", () => {
    const issues = lintLayout(
      [stroke("curve", [[100, 400], [900, 400]]), text("lbl", [500, 400])],
      heuristicMeasure,
    );
    expect(issues.some((i) => i.rule === "overlap-label-stroke")).toBe(true);
  });

  test("flags elements outside the canvas", () => {
    const issues = lintLayout([stroke("s", [[-50, 100], [200, 100]])], heuristicMeasure);
    expect(issues.some((i) => i.rule === "out-of-canvas" && i.ids.includes("s"))).toBe(true);
  });

  test("flags unreadable font sizes", () => {
    const issues = lintLayout([text("tiny", [300, 300], 8)], heuristicMeasure);
    expect(issues.some((i) => i.rule === "font-too-small")).toBe(true);
  });
});
