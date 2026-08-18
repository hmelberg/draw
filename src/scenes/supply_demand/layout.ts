// Deterministic layout for the supply_demand scene. Works in an internal
// domain of 0–100 × 0–100 mapped onto the plot area; the LLM only supplies
// qualitative parameters.

import { linearScale, plotArea } from "../../layout/canvas";
import { makeAxes } from "../../layout/axes";
import { interpolateAtX, intersectPolylines, qualitativeShape, solveForX } from "../../layout/curves";
import { centroid } from "../../layout/geometry";
import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface CurveParams {
  steepness?: "gentle" | "medium" | "steep";
  curvature?: "linear" | "convex" | "concave";
  label?: string;
}

export interface SupplyDemandParams {
  x_label?: string;
  y_label?: string;
  demand?: CurveParams;
  /** null = draw no supply curve */
  supply?: CurveParams | null;
  equilibrium?: { show?: boolean; label?: string; guides?: boolean; q_label?: string; p_label?: string };
  demand_shift?: { direction?: "right" | "left"; label?: string };
  supply_shift?: { direction?: "right" | "left"; label?: string };
  tax?: { show_deadweight_loss?: boolean; label?: string };
  price_ceiling?: { label?: string; show_shortage?: boolean };
  price_floor?: { label?: string; show_surplus?: boolean };
  regions?: ("consumer_surplus" | "producer_surplus")[];
}

const D0 = 2;
const D1 = 96; // usable slice of the 0–100 domain, keeps arrowheads clear

interface Ctx {
  sx: (v: number) => number;
  sy: (v: number) => number;
  toLogical: (pts: Pt[]) => Pt[];
}

export function layoutSupplyDemand(params: SupplyDemandParams): SceneLayout {
  const plot = plotArea();
  const sx = linearScale([0, 100], [plot.x0, plot.x1]);
  const sy = linearScale([0, 100], [plot.y0, plot.y1]);
  const ctx: Ctx = { sx, sy, toLogical: (pts) => pts.map(([x, y]): Pt => [sx(x), sy(y)]) };

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];

  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string = COLORS.ink) => {
    labels.push({
      id,
      anchor,
      side,
      text,
      fontSize: 26,
      style: defaultStyle({ color }),
      drawOpts: defaultDrawOpts("instant"),
    });
    anchors[id] = anchor;
    order.push(id);
  };

  push(makeAxes("axes", plot, params.x_label ?? "Quantity (Q)", params.y_label ?? "Price (P)"));

  // Curves in domain space (0–100 both axes).
  const demandPts = shapedCurve("decreasing", params.demand);
  const supplyPts = params.supply === null ? null : shapedCurve("increasing", params.supply ?? {});

  push(curve("demand_curve", demandPts, COLORS.demand, ctx));
  anchors["demand_curve"] = ctx.toLogical([demandPts[demandPts.length - 1]])[0];
  label("label_D", anchors["demand_curve"], "right", params.demand?.label ?? "D", COLORS.demand);

  let eq: Pt | null = null;
  if (supplyPts) {
    push(curve("supply_curve", supplyPts, COLORS.supply, ctx));
    anchors["supply_curve"] = ctx.toLogical([supplyPts[supplyPts.length - 1]])[0];
    label("label_S", anchors["supply_curve"], "right", params.supply?.label ?? "S", COLORS.supply);

    eq = intersectPolylines(demandPts, supplyPts);
    if (eq && params.equilibrium?.show !== false) {
      const eqL = ctx.toLogical([eq])[0];
      if (params.equilibrium?.guides !== false) {
        push(guides("guide_lines", eq, ctx, plot));
      }
      push(dot("equilibrium_point", eqL));
      anchors["equilibrium_point"] = eqL;
      label("label_E", eqL, "above-right", params.equilibrium?.label ?? "E");
      label("label_Pstar", [plot.x0, eqL[1]], "left", params.equilibrium?.p_label ?? "P*");
      label("label_Qstar", [eqL[0], plot.y0], "below", params.equilibrium?.q_label ?? "Q*");
    }
  }

  // Shifted curves
  for (const [kind, base, shift] of [
    ["demand", demandPts, params.demand_shift],
    ["supply", supplyPts, params.supply_shift],
  ] as const) {
    if (!shift || !base) continue;
    const dx = (shift.direction ?? "right") === "right" ? 15 : -15;
    const shifted = base.map(([x, y]): Pt => [clamp(x + dx, 0, 99), y]);
    push(curve(`${kind}_shift_curve`, shifted, COLORS.shifted, ctx));
    const endL = ctx.toLogical([shifted[shifted.length - 1]])[0];
    anchors[`${kind}_shift_curve`] = endL;
    label(`label_${kind === "demand" ? "D" : "S"}_shift`, endL, "right", shift.label ?? (kind === "demand" ? "D′" : "S′"), COLORS.shifted);
    const midBase = ctx.toLogical([base[Math.floor(base.length / 2)]])[0];
    const midShifted = ctx.toLogical([shifted[Math.floor(shifted.length / 2)]])[0];
    push({
      id: `${kind}_shift_arrow`,
      kind: "stroke",
      pts: [midBase, midShifted],
      arrowhead: "end",
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.guide, strokeWidth: 2.5 }),
      drawOpts: defaultDrawOpts("sketch", 500),
    });
  }

  // Tax: supply shifts up; new equilibrium; deadweight-loss triangle.
  if (params.tax && supplyPts && eq) {
    const taxAmount = 18;
    const taxed = supplyPts.map(([x, y]): Pt => [x, clamp(y + taxAmount, 0, 98)]);
    push({ ...curve("tax_supply_curve", taxed, COLORS.supply, ctx), style: defaultStyle({ color: COLORS.supply, strokeWidth: 4, dash: true }) });
    const taxedEndL = ctx.toLogical([taxed[taxed.length - 1]])[0];
    anchors["tax_supply_curve"] = taxedEndL;
    label("label_S_tax", taxedEndL, "above-left", params.tax.label ?? "S + tax", COLORS.supply);
    const eq2 = intersectPolylines(demandPts, taxed);
    if (eq2) {
      push(guides("tax_guide_lines", eq2, ctx, plot));
      const eq2L = ctx.toLogical([eq2])[0];
      push(dot("tax_equilibrium_point", eq2L));
      anchors["tax_equilibrium_point"] = eq2L;
      if (params.tax.show_deadweight_loss !== false) {
        const region = betweenRegion(demandPts, supplyPts, eq2[0], eq[0]);
        if (region) {
          const pts = ctx.toLogical(region);
          push({
            id: "dwl_region",
            kind: "area",
            pts,
            z: Z_AREA,
            style: defaultStyle({ color: COLORS.regionLoss, fill: COLORS.regionLoss, opacity: 0.5, strokeWidth: 1 }),
            drawOpts: defaultDrawOpts("sketch", 900),
          });
          anchors["dwl_region"] = centroid(pts);
          label("label_DWL", anchors["dwl_region"], "right", "Deadweight loss", COLORS.regionLoss);
        }
      }
    }
  }

  // Price ceiling below equilibrium (creates a shortage).
  if (params.price_ceiling && eq) {
    const pc = eq[1] * 0.62;
    addPriceLine("ceiling", pc, params.price_ceiling.label ?? "Price ceiling");
    if (params.price_ceiling.show_shortage !== false && supplyPts) {
      addGap("shortage", pc, solveForX(supplyPts, pc), solveForX(demandPts, pc), "Shortage");
    }
  }

  // Price floor above equilibrium (creates a surplus).
  if (params.price_floor && eq) {
    const pf = Math.min(eq[1] * 1.35, 92);
    addPriceLine("floor", pf, params.price_floor.label ?? "Price floor");
    if (params.price_floor.show_surplus !== false && supplyPts) {
      addGap("surplus", pf, solveForX(demandPts, pf), solveForX(supplyPts, pf), "Surplus");
    }
  }

  // Consumer / producer surplus at the market equilibrium.
  if (params.regions && eq) {
    const [qStar, pStar] = eq;
    if (params.regions.includes("consumer_surplus")) {
      const upper = demandPts.filter(([x]) => x <= qStar);
      const pts = ctx.toLogical([...upper, [qStar, pStar], [D0, pStar]]);
      push(area("cs_region", pts, COLORS.region1));
      anchors["cs_region"] = centroid(pts);
      label("label_CS", anchors["cs_region"], "above-right", "Consumer surplus");
    }
    if (params.regions.includes("producer_surplus") && supplyPts) {
      const lower = supplyPts.filter(([x]) => x <= qStar);
      const pts = ctx.toLogical([[D0, pStar], [qStar, pStar], ...lower.reverse()]);
      push(area("ps_region", pts, COLORS.region2));
      anchors["ps_region"] = centroid(pts);
      label("label_PS", anchors["ps_region"], "below-right", "Producer surplus");
    }
  }

  return { drawables, labels, anchors, order };

  function addPriceLine(kind: "ceiling" | "floor", p: number, text: string) {
    const pts = ctx.toLogical([
      [D0, p],
      [D1, p],
    ]);
    push({
      id: `${kind}_line`,
      kind: "stroke",
      pts,
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.accent, strokeWidth: 3.5, dash: true }),
      drawOpts: defaultDrawOpts("sketch", 900),
    });
    anchors[`${kind}_line`] = pts[1];
    label(`label_${kind}`, pts[1], "above-left", text, COLORS.accent);
  }

  function addGap(kind: "shortage" | "surplus", p: number, qLow: number | null, qHigh: number | null, text: string) {
    if (qLow === null || qHigh === null) return;
    const [qa, qb] = qLow < qHigh ? [qLow, qHigh] : [qHigh, qLow];
    push({
      id: `${kind}_guides`,
      kind: "stroke",
      pts: ctx.toLogical([
        [qa, p],
        [qa, 0],
      ]).concat(ctx.toLogical([
        [qb, p],
        [qb, 0],
      ])),
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.9 }),
      drawOpts: defaultDrawOpts("sketch", 500),
    });
    const arrowY = kind === "shortage" ? p * 0.45 : Math.min(p * 1.12, 96);
    const arrowPts = ctx.toLogical([
      [qa, arrowY],
      [qb, arrowY],
    ]);
    push({
      id: `${kind}_arrow`,
      kind: "stroke",
      pts: arrowPts,
      arrowhead: "both",
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.accent, strokeWidth: 3 }),
      drawOpts: defaultDrawOpts("sketch", 600),
    });
    const mid: Pt = [(arrowPts[0][0] + arrowPts[1][0]) / 2, arrowPts[0][1]];
    anchors[`${kind}_arrow`] = mid;
    label(`label_${kind}`, mid, kind === "shortage" ? "below" : "above", text, COLORS.accent);
  }
}

function shapedCurve(direction: "increasing" | "decreasing", p: CurveParams | undefined): Pt[] {
  const shape = qualitativeShape(direction, p?.curvature ?? "linear", p?.steepness ?? "medium");
  return shape.map(([tx, ty]): Pt => [D0 + (D1 - D0) * tx, ty * 100]);
}

function curve(id: string, domainPts: Pt[], color: string, ctx: Ctx): StrokeDrawable {
  return {
    id,
    kind: "stroke",
    pts: ctx.toLogical(domainPts),
    z: Z_STROKE,
    style: defaultStyle({ color, strokeWidth: 4 }),
    drawOpts: defaultDrawOpts("sketch", 1600),
  };
}

function dot(id: string, c: Pt): StrokeDrawable {
  return {
    id,
    kind: "stroke",
    pts: [c],
    shapeHint: { type: "circle", c, r: 7 },
    z: Z_STROKE,
    style: defaultStyle({ strokeWidth: 3, fill: COLORS.ink }),
    drawOpts: defaultDrawOpts("sketch", 350),
  };
}

function guides(id: string, domainPt: Pt, ctx: Ctx, plot: ReturnType<typeof plotArea>): StrokeDrawable {
  const p = ctx.toLogical([domainPt])[0];
  return {
    id,
    kind: "stroke",
    pts: [
      [plot.x0, p[1]],
      p,
      [p[0], plot.y0],
    ],
    z: Z_STROKE,
    style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.9 }),
    drawOpts: defaultDrawOpts("sketch", 700),
  };
}

function area(id: string, pts: Pt[], color: string): Drawable {
  return {
    id,
    kind: "area",
    pts,
    z: Z_AREA,
    style: defaultStyle({ color, fill: color, opacity: 0.5, strokeWidth: 1 }),
    drawOpts: defaultDrawOpts("sketch", 900),
  };
}

function betweenRegion(a: Pt[], b: Pt[], x0: number, x1: number): Pt[] | null {
  if (x1 <= x0) return null;
  const N = 24;
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const ya = interpolateAtX(a, x);
    const yb = interpolateAtX(b, x);
    if (ya === null || yb === null) continue;
    upper.push([x, ya]);
    lower.push([x, yb]);
  }
  if (upper.length < 2) return null;
  return [...upper, ...lower.reverse()];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
