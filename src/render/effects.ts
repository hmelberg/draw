// Pure motion math for the gesture verbs: easing curves, offset-path
// interpolation (move), camera box interpolation, and the laser-pointer
// trajectory. No DOM — the Player drives these against backend primitives.

import { CANVAS } from "../layout/canvas";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Easing, PointGesture } from "../spec/types";

export type EasingFn = (t: number) => number;

export const EASINGS: Record<Easing, EasingFn> = {
  linear: (t) => t,
  "ease-in": (t) => t * t,
  "ease-out": (t) => 1 - (1 - t) * (1 - t),
  "ease-in-out": (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

export const FULL_CANVAS_BOX: BBox = { x: 0, y: 0, w: CANVAS.w, h: CANVAS.h };

/**
 * Position along a waypoint offset path at eased parameter t ∈ [0,1].
 * The path starts at the implicit origin [0,0]; parameterized by arc length so
 * speed is uniform across unevenly spaced waypoints.
 */
export function pathPosition(waypoints: Pt[], t: number): Pt {
  const pts: Pt[] = [[0, 0], ...waypoints];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    lengths.push(len);
    total += len;
  }
  if (total === 0) return pts[pts.length - 1];
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] === 0 ? 1 : remaining / lengths[i];
      return [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f,
      ];
    }
    remaining -= lengths[i];
  }
  return pts[pts.length - 1];
}

export function unionBoxes(boxes: BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function lerpBox(a: BBox, b: BBox, t: number): BBox {
  const l = (p: number, q: number) => p + (q - p) * t;
  return { x: l(a.x, b.x), y: l(a.y, b.y), w: l(a.w, b.w), h: l(a.h, b.h) };
}

export interface PointerTarget {
  x: number;
  y: number;
  box?: BBox;
}

/**
 * Laser-pointer trajectory: glide in from the lower right, perform the
 * gesture, hold briefly. Returns logical y-up position for t ∈ [0,1].
 */
export function pointerPath(target: PointerTarget, gesture: PointGesture): (t: number) => Pt {
  const { x, y, box } = target;
  const entryFrom: Pt = [Math.min(x + 160, CANVAS.w - 15), Math.max(y - 130, 15)];
  const ENTRY = 0.22;

  const gestureAt = (u: number): Pt => {
    if (gesture === "circle") {
      // Trace 1.25 loops around the target's box (or a small ring around the point).
      const rx = box ? box.w / 2 + 20 : 32;
      const ry = box ? box.h / 2 + 16 : 32;
      const angle = -Math.PI / 3 + u * 2 * Math.PI * 1.25;
      return [x + rx * Math.cos(angle), y + ry * Math.sin(angle)];
    }
    if (gesture === "underline") {
      // Sweep beneath the target, out and back.
      const half = box ? box.w / 2 + 10 : 45;
      const baseY = box ? box.y - 14 : y - 20;
      const sweep = Math.sin(u * Math.PI * 1.5); // out to +half, back through center
      return [x + half * sweep, baseY];
    }
    // tap: two gentle dips at the spot
    const dip = Math.abs(Math.sin(u * Math.PI * 2)) * 16 * (1 - u * 0.5);
    return [x, y - dip];
  };

  const gestureStart = gestureAt(0);
  return (t: number) => {
    const tc = Math.min(Math.max(t, 0), 1);
    if (tc < ENTRY) {
      const u = EASINGS["ease-out"](tc / ENTRY);
      return [
        entryFrom[0] + (gestureStart[0] - entryFrom[0]) * u,
        entryFrom[1] + (gestureStart[1] - entryFrom[1]) * u,
      ];
    }
    if (tc > 0.95) return gestureAt(1);
    return gestureAt((tc - ENTRY) / (0.95 - ENTRY));
  };
}
