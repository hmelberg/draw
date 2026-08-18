// Curve sampling shared by scenes and tier-2 layout. Everything works on
// normalized [0,1]×[0,1] "shape space" and is then mapped by the caller.

import { compileExpression } from "../spec/expression";
import type { Pt } from "./model";

export const CURVE_SAMPLES = 60;

const STEEPNESS: Record<string, number> = { gentle: 0.55, medium: 1, steep: 1.5 };

/**
 * Qualitative curve in shape space: x in [0,1] → y in [0,1].
 * Curvature is relative to the curve's own run (convex = bowed toward the
 * origin corner for decreasing curves — the classic demand-curve look).
 */
export function qualitativeShape(
  direction: "increasing" | "decreasing" | "flat" | "vertical",
  curvature: "linear" | "convex" | "concave" = "linear",
  steepness: "gentle" | "medium" | "steep" = "medium",
): Pt[] {
  const k = STEEPNESS[steepness] ?? 1;
  const pts: Pt[] = [];
  const lo = Math.max(0.06, 0.5 - 0.42 * k);
  const hi = Math.min(0.94, 0.5 + 0.42 * k);
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = i / CURVE_SAMPLES;
    let shape: number;
    if (curvature === "convex") {
      shape = (Math.exp(2.6 * t) - 1) / (Math.exp(2.6) - 1);
    } else if (curvature === "concave") {
      shape = (1 - Math.exp(-2.6 * t)) / (1 - Math.exp(-2.6));
    } else {
      shape = t;
    }
    let y: number;
    switch (direction) {
      case "increasing":
        y = lo + (hi - lo) * shape;
        break;
      case "decreasing":
        y = hi - (hi - lo) * shape;
        break;
      case "flat":
        y = 0.5;
        break;
      case "vertical":
        y = lo + (hi - lo) * t;
        break;
    }
    const x = direction === "vertical" ? 0.5 : t;
    pts.push([x, y]);
  }
  return pts;
}

/** Sample an explicit expression y = f(x) over [x0, x1] in domain units. */
export function sampleExpression(expr: string, x0: number, x1: number): Pt[] {
  const f = compileExpression(expr, ["x", "X", "q", "Q", "t", "T"]);
  const pts: Pt[] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / CURVE_SAMPLES;
    const y = f({ x, X: x, q: x, Q: x, t: x, T: x });
    if (Number.isFinite(y)) pts.push([x, y]);
  }
  if (pts.length < 2) throw new Error(`expression "${expr}" produced no finite points over [${x0}, ${x1}]`);
  return pts;
}

/** Interpolate a polyline (sorted by x) at a given x. */
export function interpolateAtX(pts: Pt[], x: number): number | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    if ((x >= xa && x <= xb) || (x >= xb && x <= xa)) {
      const t = xb === xa ? 0 : (x - xa) / (xb - xa);
      return ya + t * (yb - ya);
    }
  }
  return null;
}

/** Find an intersection of two polylines sampled over a shared x range. */
export function intersectPolylines(a: Pt[], b: Pt[]): Pt | null {
  const x0 = Math.max(Math.min(...a.map((p) => p[0])), Math.min(...b.map((p) => p[0])));
  const x1 = Math.min(Math.max(...a.map((p) => p[0])), Math.max(...b.map((p) => p[0])));
  if (x1 <= x0) return null;
  const N = 200;
  let prevDiff: number | null = null;
  let prevX = x0;
  for (let i = 0; i <= N; i++) {
    const x = x0 + ((x1 - x0) * i) / N;
    const ya = interpolateAtX(a, x);
    const yb = interpolateAtX(b, x);
    if (ya === null || yb === null) continue;
    const diff = ya - yb;
    if (prevDiff !== null && (diff === 0 || (diff > 0) !== (prevDiff > 0))) {
      // linear refinement between prevX and x
      const t = prevDiff / (prevDiff - diff);
      const xi = prevX + t * (x - prevX);
      const yi = interpolateAtX(a, xi);
      if (yi !== null) return [xi, yi];
    }
    prevDiff = diff;
    prevX = x;
  }
  return null;
}

/** Invert a monotone-ish polyline: find x where y(x) = target. */
export function solveForX(pts: Pt[], targetY: number): number | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [xa, ya] = pts[i];
    const [xb, yb] = pts[i + 1];
    if ((targetY >= ya && targetY <= yb) || (targetY >= yb && targetY <= ya)) {
      const t = yb === ya ? 0 : (targetY - ya) / (yb - ya);
      return xa + t * (xb - xa);
    }
  }
  return null;
}
