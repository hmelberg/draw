import { describe, expect, test } from "vitest";
import { placeLabels, type LabelRequest } from "../src/layout/labels";
import { heuristicMeasure } from "../src/layout/measure";
import { bboxOfText, boxesOverlap } from "../src/layout/geometry";
import { defaultStyle, defaultDrawOpts } from "../src/layout/model";

function req(id: string, anchor: [number, number], side: LabelRequest["side"] = "above-right", text = "Label"): LabelRequest {
  return { id, anchor, side, text, fontSize: 24, style: defaultStyle(), drawOpts: defaultDrawOpts("instant") };
}

describe("placeLabels", () => {
  test("a lone label lands on its preferred side", () => {
    const [placed] = placeLabels([req("l1", [500, 400])], [], heuristicMeasure);
    expect(placed.text.pos[0]).toBeGreaterThan(500);
    expect(placed.text.pos[1]).toBeGreaterThan(400);
    expect(placed.leader).toBeUndefined();
  });

  test("two labels on the same anchor do not overlap", () => {
    const placed = placeLabels([req("l1", [500, 400]), req("l2", [500, 400])], [], heuristicMeasure);
    const boxes = placed.map((p) => bboxOfText(p.text, heuristicMeasure));
    expect(boxesOverlap(boxes[0], boxes[1])).toBe(false);
  });

  test("a label near the canvas edge is pushed inside", () => {
    const [placed] = placeLabels([req("l1", [995, 745])], [], heuristicMeasure);
    const box = bboxOfText(placed.text, heuristicMeasure);
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
    expect(box.y + box.h).toBeLessThanOrEqual(750);
  });

  test("long labels wrap into multiple lines and stay inside the canvas", () => {
    const [placed] = placeLabels(
      [req("l1", [820, 400], "right", "Deadweight loss from the per-unit tax on producers")],
      [],
      heuristicMeasure,
    );
    expect(placed.text.lines!.length).toBeGreaterThanOrEqual(2);
    const box = bboxOfText(placed.text, heuristicMeasure);
    expect(box.x + box.w).toBeLessThanOrEqual(1000);
    expect(box.h).toBeGreaterThan(placed.text.fontSize * 2);
  });

  test("short labels stay single-line", () => {
    const [placed] = placeLabels([req("l1", [500, 400], "right", "D")], [], heuristicMeasure);
    expect(placed.text.lines).toBeUndefined();
  });

  test("when all near candidates are blocked, the label is displaced with a leader line", () => {
    // Surround the anchor with obstacles so every close candidate collides.
    const obstacles = [];
    for (let dx = -220; dx <= 220; dx += 55) {
      for (let dy = -120; dy <= 120; dy += 30) {
        obstacles.push({ x: 500 + dx - 27, y: 400 + dy - 15, w: 54, h: 30 });
      }
    }
    const [placed] = placeLabels([req("l1", [500, 400])], obstacles, heuristicMeasure);
    expect(placed.leader).toBeDefined();
    expect(placed.leader!.pts.length).toBeGreaterThanOrEqual(2);
  });
});
