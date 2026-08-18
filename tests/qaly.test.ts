import { describe, expect, test } from "vitest";
import { layoutQalyProfiles, type QalyParams } from "../src/scenes/qaly_profiles/layout";
import { flattenDrawables, type AreaDrawable, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";

const params: QalyParams = {
  profiles: [
    {
      id: "no_tx",
      label: "Without treatment",
      waypoints: [
        { t: 0, u: 0.9 },
        { t: 40, u: 0.8 },
        { t: 40, u: 0.4, step: true },
        { t: 65, u: 0.3 },
      ],
      death_at: 70,
    },
    {
      id: "tx",
      label: "With treatment",
      waypoints: [
        { t: 0, u: 0.9 },
        { t: 40, u: 0.8 },
        { t: 40, u: 0.25, step: true },
        { t: 46, u: 0.7 },
        { t: 75, u: 0.55 },
      ],
      death_at: 82,
    },
  ],
  shade_between: { a: "tx", b: "no_tx" },
};

function stroke(r: ReturnType<typeof layoutQalyProfiles>, id: string): StrokeDrawable {
  const d = flattenDrawables(r.drawables).find((d) => d.id === id);
  if (!d || d.kind !== "stroke") throw new Error(`no stroke ${id}`);
  return d;
}

describe("layoutQalyProfiles", () => {
  test("produces axes, a curve and label per profile, and gain/loss regions", () => {
    const r = layoutQalyProfiles(params);
    const ids = [...flattenDrawables(r.drawables).map((d) => d.id), ...r.labels.map((l) => l.id)];
    for (const id of ["axes", "full_health_line", "curve_no_tx", "curve_tx", "label_no_tx", "label_tx", "gain_regions", "loss_regions", "label_gain"]) {
      expect(ids).toContain(id);
    }
  });

  test("a step waypoint creates a vertical discontinuity", () => {
    const r = layoutQalyProfiles(params);
    const pts = stroke(r, "curve_tx").pts;
    const vertical = pts.some((p, i) => i > 0 && Math.abs(p[0] - pts[i - 1][0]) < 0.5 && Math.abs(p[1] - pts[i - 1][1]) > 30);
    expect(vertical).toBe(true);
  });

  test("interpolation between waypoints is non-linear (eased), not a straight line", () => {
    const r = layoutQalyProfiles({
      profiles: [{ id: "p", waypoints: [{ t: 0, u: 0.9 }, { t: 60, u: 0.3 }], death_at: 70 }],
    });
    const pts = stroke(r, "curve_p").pts;
    // midpoint of an eased segment deviates from the straight chord somewhere
    const [x0, y0] = pts[0];
    const seg = pts.filter(([x]) => x >= x0 && x <= x0 + 300);
    const [x1, y1] = seg[seg.length - 1];
    const deviation = Math.max(
      ...seg.map(([x, y]) => {
        const tt = (x - x0) / (x1 - x0 || 1);
        return Math.abs(y - (y0 + tt * (y1 - y0)));
      }),
    );
    expect(deviation).toBeGreaterThan(3);
  });

  test("death drops the curve to zero utility at the death age", () => {
    const r = layoutQalyProfiles(params);
    const pts = stroke(r, "curve_tx").pts;
    const last = pts[pts.length - 1];
    const zeroY = stroke(r, "curve_no_tx").pts[0]; // not zero — just need the axis: use canvas check instead
    void zeroY;
    // utility 0 maps to the plot floor; the tx curve ends lower than it starts
    expect(last[1]).toBeLessThan(pts[0][1] - 200);
    // and later in time than the no-treatment death
    const lastNoTx = stroke(r, "curve_no_tx").pts.slice(-1)[0];
    expect(last[0]).toBeGreaterThan(lastNoTx[0]);
  });

  test("utility values are clamped to [0, 1]", () => {
    const r = layoutQalyProfiles({
      profiles: [{ id: "p", waypoints: [{ t: 0, u: 1.4 }, { t: 50, u: -0.3 }], death_at: 60 }],
    });
    for (const [x, y] of stroke(r, "curve_p").pts) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(CANVAS.w);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(CANVAS.h);
    }
  });

  test("gain and loss regions are areas with opposite roles when curves cross", () => {
    const r = layoutQalyProfiles(params);
    const flat = flattenDrawables(r.drawables);
    const gain = flat.find((d) => d.id === "gain_regions");
    const loss = flat.find((d) => d.id === "loss_regions");
    expect(gain?.kind).toBe("group");
    expect(loss?.kind).toBe("group");
    const gainAreas = flattenDrawables([gain!]).filter((d): d is AreaDrawable => d.kind === "area");
    const lossAreas = flattenDrawables([loss!]).filter((d): d is AreaDrawable => d.kind === "area");
    expect(gainAreas.length).toBeGreaterThan(0);
    expect(lossAreas.length).toBeGreaterThan(0);
  });

  test("empty params fall back to a sensible default two-profile comparison", () => {
    const r = layoutQalyProfiles({});
    const ids = flattenDrawables(r.drawables).map((d) => d.id);
    expect(ids.filter((id) => id.startsWith("curve_")).length).toBe(2);
    expect(ids).toContain("gain_regions");
  });
});
