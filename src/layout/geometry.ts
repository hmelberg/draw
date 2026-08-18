import { type Pt, type TextDrawable } from "./model";
import type { MeasureFn } from "./measure";

/** Axis-aligned box in logical y-up coordinates; (x, y) is the min corner. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boxesOverlap(a: BBox, b: BBox, pad = 0): boolean {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function expandBox(b: BBox, pad: number): BBox {
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

export function bboxOfPts(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Text position is the horizontal anchor at the vertical center of the block. */
export function bboxOfText(t: TextDrawable, measure: MeasureFn): BBox {
  let w: number;
  let h: number;
  if (t.lines && t.lines.length > 1) {
    w = Math.max(...t.lines.map((line) => measure(line, t.fontSize).w));
    h = t.lines.length * t.fontSize * 1.25;
  } else {
    ({ w, h } = measure(t.text, t.fontSize));
  }
  const x = t.anchor === "start" ? t.pos[0] : t.anchor === "end" ? t.pos[0] - w : t.pos[0] - w / 2;
  return { x, y: t.pos[1] - h / 2, w, h };
}

/** Liang–Barsky segment-vs-box test. */
export function segmentIntersectsBox(a: Pt, b: Pt, box: BBox): boolean {
  const [x0, y0] = a;
  const dx = b[0] - x0;
  const dy = b[1] - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - box.x, box.x + box.w - x0, y0 - box.y, box.y + box.h - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return true;
}

export function polylineIntersectsBox(pts: Pt[], box: BBox): boolean {
  for (let i = 0; i + 1 < pts.length; i++) {
    if (segmentIntersectsBox(pts[i], pts[i + 1], box)) return true;
  }
  return false;
}

export function centroid(pts: Pt[]): Pt {
  let sx = 0, sy = 0;
  for (const [x, y] of pts) {
    sx += x;
    sy += y;
  }
  const n = pts.length || 1;
  return [sx / n, sy / n];
}
