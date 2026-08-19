import { describe, expect, test } from "vitest";
import { EASINGS, lerpBox, pathPosition, pointerPath, unionBoxes } from "../src/render/effects";

describe("easings", () => {
  test("all easings are identity at the endpoints", () => {
    for (const ease of Object.values(EASINGS)) {
      expect(ease(0)).toBeCloseTo(0);
      expect(ease(1)).toBeCloseTo(1);
    }
  });

  test("ease-in-out is symmetric around the midpoint", () => {
    expect(EASINGS["ease-in-out"](0.5)).toBeCloseTo(0.5);
    expect(EASINGS["ease-in-out"](0.25)).toBeCloseTo(1 - EASINGS["ease-in-out"](0.75));
  });
});

describe("pathPosition", () => {
  test("starts at the origin and ends at the last waypoint", () => {
    const path: [number, number][] = [[10, 0], [10, 20]];
    expect(pathPosition(path, 0)).toEqual([0, 0]);
    expect(pathPosition(path, 1)).toEqual([10, 20]);
  });

  test("parameterizes by arc length", () => {
    // Two segments of length 10 and 20: t=1/3 is the corner.
    const path: [number, number][] = [[10, 0], [10, 20]];
    const [x, y] = pathPosition(path, 1 / 3);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(0);
  });

  test("a single waypoint behaves as a straight-line delta", () => {
    expect(pathPosition([[100, 50]], 0.5)).toEqual([50, 25]);
  });

  test("a zero-length path returns the final offset", () => {
    expect(pathPosition([[0, 0]], 0.3)).toEqual([0, 0]);
  });
});

describe("boxes", () => {
  test("unionBoxes covers all inputs", () => {
    expect(unionBoxes([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 30, h: 15 });
    expect(unionBoxes([])).toBeNull();
  });

  test("lerpBox interpolates componentwise", () => {
    const mid = lerpBox({ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 100, w: 0, h: 0 }, 0.5);
    expect(mid).toEqual({ x: 50, y: 50, w: 50, h: 50 });
  });
});

describe("pointerPath", () => {
  const target = { x: 500, y: 300, box: { x: 480, y: 290, w: 40, h: 20 } };

  test("ends at the target for a tap", () => {
    const p = pointerPath(target, "tap")(1);
    expect(p[0]).toBeCloseTo(500);
    expect(p[1]).toBeCloseTo(300);
  });

  test("circle gesture stays on the ring around the box", () => {
    const path = pointerPath(target, "circle");
    for (const t of [0.3, 0.5, 0.7, 0.9]) {
      const [x, y] = path(t);
      const dx = (x - 500) / (40 / 2 + 20);
      const dy = (y - 300) / (20 / 2 + 16);
      expect(dx * dx + dy * dy).toBeCloseTo(1, 5);
    }
  });

  test("underline sweeps beneath the box", () => {
    const path = pointerPath(target, "underline");
    for (const t of [0.3, 0.6, 0.9]) {
      expect(path(t)[1]).toBeCloseTo(target.box.y - 14);
    }
  });

  test("positions stay finite over the whole trajectory", () => {
    for (const gesture of ["tap", "circle", "underline"] as const) {
      const path = pointerPath({ x: 100, y: 100 }, gesture);
      for (let t = 0; t <= 1; t += 0.05) {
        const [x, y] = path(t);
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });
});
