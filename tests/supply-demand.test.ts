import { describe, expect, test } from "vitest";
import { layoutSupplyDemand } from "../src/scenes/supply_demand/layout";
import { flattenDrawables, type StrokeDrawable } from "../src/layout/model";
import { CANVAS } from "../src/layout/canvas";

function ids(result: ReturnType<typeof layoutSupplyDemand>): string[] {
  return [
    ...flattenDrawables(result.drawables).map((d) => d.id),
    ...result.labels.map((l) => l.id),
  ];
}

function stroke(result: ReturnType<typeof layoutSupplyDemand>, id: string): StrokeDrawable {
  const d = flattenDrawables(result.drawables).find((d) => d.id === id);
  if (!d || d.kind !== "stroke") throw new Error(`no stroke drawable ${id}`);
  return d;
}

describe("layoutSupplyDemand", () => {
  test("default params produce axes, curves, and equilibrium elements", () => {
    const r = layoutSupplyDemand({});
    const all = ids(r);
    for (const id of ["axes", "demand_curve", "supply_curve", "equilibrium_point", "guide_lines", "label_D", "label_S"]) {
      expect(all).toContain(id);
    }
  });

  test("equilibrium point sits on both curves", () => {
    const r = layoutSupplyDemand({});
    const eq = stroke(r, "equilibrium_point");
    const [ex, ey] = eq.shapeHint && eq.shapeHint.type === "circle" ? eq.shapeHint.c : eq.pts[0];
    for (const curveId of ["demand_curve", "supply_curve"]) {
      const pts = stroke(r, curveId).pts;
      const nearest = Math.min(...pts.map(([x, y]) => Math.hypot(x - ex, y - ey)));
      expect(nearest).toBeLessThan(15);
    }
  });

  test("all geometry stays inside the logical canvas", () => {
    const r = layoutSupplyDemand({ tax: { show_deadweight_loss: true }, price_ceiling: { show_shortage: true } });
    for (const d of flattenDrawables(r.drawables)) {
      if (d.kind === "stroke" || d.kind === "area") {
        for (const [x, y] of d.pts) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS.w);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(CANVAS.h);
        }
      }
    }
  });

  test("price ceiling sits below equilibrium and produces shortage elements", () => {
    const r = layoutSupplyDemand({ price_ceiling: { show_shortage: true } });
    const all = ids(r);
    expect(all).toContain("ceiling_line");
    expect(all).toContain("shortage_arrow");
    const eq = stroke(r, "equilibrium_point");
    const eqY = eq.shapeHint && eq.shapeHint.type === "circle" ? eq.shapeHint.c[1] : eq.pts[0][1];
    const ceilingY = stroke(r, "ceiling_line").pts[0][1];
    expect(ceilingY).toBeLessThan(eqY);
  });

  test("tax adds a shifted supply curve above the original and a deadweight-loss region", () => {
    const r = layoutSupplyDemand({ tax: { show_deadweight_loss: true } });
    const all = ids(r);
    expect(all).toContain("tax_supply_curve");
    expect(all).toContain("dwl_region");
    const base = stroke(r, "supply_curve").pts;
    const taxed = stroke(r, "tax_supply_curve").pts;
    const midBase = base[Math.floor(base.length / 2)];
    const midTaxed = taxed.find(([x]) => Math.abs(x - midBase[0]) < 20);
    expect(midTaxed).toBeDefined();
    expect(midTaxed![1]).toBeGreaterThan(midBase[1]);
    const dwl = flattenDrawables(r.drawables).find((d) => d.id === "dwl_region");
    expect(dwl?.kind).toBe("area");
  });

  test("demand shift produces a second curve and a shift arrow", () => {
    const r = layoutSupplyDemand({ demand_shift: { direction: "right", label: "D'" } });
    const all = ids(r);
    expect(all).toContain("demand_shift_curve");
    expect(all).toContain("demand_shift_arrow");
    expect(all).toContain("label_D_shift");
  });

  test("surplus regions are areas placed behind strokes (lower z)", () => {
    const r = layoutSupplyDemand({ regions: ["consumer_surplus", "producer_surplus"] });
    const flat = flattenDrawables(r.drawables);
    const cs = flat.find((d) => d.id === "cs_region");
    const demand = flat.find((d) => d.id === "demand_curve");
    expect(cs?.kind).toBe("area");
    expect(cs!.z).toBeLessThan(demand!.z);
  });
});
