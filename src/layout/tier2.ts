// Tier-2/3 layout: turns semantic elements into Drawables. The LLM never
// places anything here except tier-3 escape-hatch coordinates.

import { CANVAS, linearScale, plotArea } from "./canvas";
import { makeAxes } from "./axes";
import { interpolateAtX, intersectPolylines, qualitativeShape, sampleExpression } from "./curves";
import { centroid } from "./geometry";
import { heuristicMeasure } from "./measure";
import {
  COLORS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";
import { resolveDrawOpts, resolveStyle } from "./resolve";
import type { LabelRequest } from "./labels";
import type { SpecElement } from "../spec/types";

export interface Tier2Result {
  drawables: Drawable[];
  labels: LabelRequest[];
  /** Logical anchor point per element id (for labels, arrows, and commands). */
  anchors: Record<string, Pt>;
  warnings: string[];
}

interface Ctx {
  sx: (v: number) => number;
  sy: (v: number) => number;
  domainX: [number, number];
  domainY: [number, number];
  domainDeclared: boolean;
  /** curve samples in domain coordinates, for intersections/regions */
  curveSamples: Map<string, Pt[]>;
  nodeRadius: Map<string, number>;
  anchors: Record<string, Pt>;
  warnings: string[];
}

export function layoutElements(
  elements: SpecElement[],
  domain: { x?: [number, number]; y?: [number, number] } | undefined,
): Tier2Result {
  const plot = plotArea();
  const domainX: [number, number] = domain?.x ?? [0, 100];
  const domainY: [number, number] = domain?.y ?? [0, 100];
  const ctx: Ctx = {
    sx: linearScale(domainX, [plot.x0, plot.x1]),
    sy: linearScale(domainY, [plot.y0, plot.y1]),
    domainX,
    domainY,
    domainDeclared: domain !== undefined,
    curveSamples: new Map(),
    nodeRadius: new Map(),
    anchors: {},
    warnings: [],
  };

  // Pass 1: position free nodes deterministically on a circle.
  const freeNodes = elements.filter((e) => e.type === "node" && e.x === undefined);
  const center: Pt = [CANVAS.w / 2, CANVAS.h / 2 + 10];
  const ringRadius = Math.min(CANVAS.w, CANVAS.h) * 0.32;
  freeNodes.forEach((node, i) => {
    if (freeNodes.length === 1) {
      ctx.anchors[node.id] = center;
      return;
    }
    const angle = Math.PI / 2 - (2 * Math.PI * i) / freeNodes.length;
    ctx.anchors[node.id] = [center[0] + ringRadius * Math.cos(angle), center[1] + ringRadius * Math.sin(angle)];
  });
  for (const node of elements.filter((e) => e.type === "node" && e.x !== undefined)) {
    ctx.anchors[node.id] = [node.x!, node.y ?? CANVAS.h / 2];
  }

  // Pass 2: sample curves (needed before points/regions regardless of order).
  for (const el of elements.filter((e) => e.type === "curve")) {
    try {
      ctx.curveSamples.set(el.id, sampleCurveDomain(el, ctx));
    } catch (err) {
      ctx.warnings.push(`curve "${el.id}": ${(err as Error).message} — using a straight line`);
      ctx.curveSamples.set(el.id, sampleCurveDomain({ ...el, expr: undefined, direction: el.direction ?? "decreasing" }, ctx));
    }
  }

  // Pass 3: emit drawables in element order.
  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  for (const el of elements) {
    switch (el.type) {
      case "axes":
        drawables.push(makeAxes(el.id, plot, el.x_label, el.y_label));
        ctx.anchors[el.id] = [plot.x1 - 60, plot.y0 + 40];
        break;
      case "curve":
        drawables.push(curveDrawable(el, ctx));
        break;
      case "point":
        drawables.push(...pointDrawables(el, ctx, plot));
        break;
      case "region":
        drawables.push(...regionDrawable(el, ctx));
        break;
      case "node":
        drawables.push(...nodeDrawables(el, ctx));
        break;
      case "arrow":
      case "edge":
        drawables.push(...connectorDrawable(el, ctx));
        break;
      case "label": {
        const anchor = ctx.anchors[el.attach_to ?? ""];
        if (!anchor) {
          ctx.warnings.push(`label "${el.id}": unknown attach_to "${el.attach_to}" — placing at canvas center`);
        }
        labels.push({
          id: el.id,
          anchor: anchor ?? [CANVAS.w / 2, CANVAS.h / 2],
          side: el.side ?? "above-right",
          text: el.text ?? el.id,
          fontSize: el.font_size ?? 26,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "instant" }),
        });
        break;
      }
      case "path": {
        const pts = (el.points ?? []) as Pt[];
        drawables.push({
          id: el.id,
          kind: "stroke",
          pts,
          closed: el.closed,
          z: Z_STROKE,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw),
        });
        ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)] ?? [CANVAS.w / 2, CANVAS.h / 2];
        break;
      }
      case "text": {
        const pos: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
        drawables.push({
          id: el.id,
          kind: "text",
          pos,
          text: el.text ?? "",
          fontSize: el.font_size ?? 26,
          anchor: "middle",
          z: Z_TEXT,
          style: resolveStyle(el.style),
          drawOpts: resolveDrawOpts(el.draw, { mode: "instant" }),
        });
        ctx.anchors[el.id] = pos;
        break;
      }
      case "shape":
        drawables.push(shapeDrawable(el, ctx));
        break;
    }
  }

  return { drawables, labels, anchors: ctx.anchors, warnings: ctx.warnings };
}

function sampleCurveDomain(el: SpecElement, ctx: Ctx): Pt[] {
  const [dx0, dx1] = ctx.domainX;
  const [dy0, dy1] = ctx.domainY;
  const x0 = el.x_from ?? dx0 + (dx1 - dx0) * 0.02;
  const x1 = el.x_to ?? dx1 - (dx1 - dx0) * 0.02;
  if (el.expr) {
    return sampleExpression(el.expr, x0, x1).map(([x, y]): Pt => [x, clamp(y, dy0, dy1)]);
  }
  const shape = qualitativeShape(el.direction ?? "decreasing", el.curvature ?? "linear", el.steepness ?? "medium");
  return shape.map(([tx, ty]): Pt => [x0 + (x1 - x0) * tx, dy0 + (dy1 - dy0) * ty]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function toLogical(pts: Pt[], ctx: Ctx): Pt[] {
  return pts.map(([x, y]): Pt => [ctx.sx(x), ctx.sy(y)]);
}

function curveDrawable(el: SpecElement, ctx: Ctx): StrokeDrawable {
  const domainPts = ctx.curveSamples.get(el.id)!;
  const pts = toLogical(domainPts, ctx);
  ctx.anchors[el.id] = pts[pts.length - 1];
  return {
    id: el.id,
    kind: "stroke",
    pts,
    z: Z_STROKE,
    style: resolveStyle(el.style, { strokeWidth: 4 }),
    drawOpts: resolveDrawOpts(el.draw, { duration: 1600 }),
  };
}

function resolvePointDomain(el: SpecElement, ctx: Ctx): Pt | null {
  const at = el.at;
  if (!at) return null;
  if (at.intersection_of && at.intersection_of.length === 2) {
    const a = ctx.curveSamples.get(at.intersection_of[0]);
    const b = ctx.curveSamples.get(at.intersection_of[1]);
    if (!a || !b) {
      ctx.warnings.push(`point "${el.id}": intersection_of references unknown curves`);
      return null;
    }
    const hit = intersectPolylines(a, b);
    if (!hit) {
      ctx.warnings.push(`point "${el.id}": curves do not intersect in the domain`);
      return null;
    }
    return hit;
  }
  if (at.x !== undefined && at.y !== undefined) return [at.x, at.y];
  return null;
}

function pointDrawables(el: SpecElement, ctx: Ctx, plot: ReturnType<typeof plotArea>): Drawable[] {
  const domainPt = resolvePointDomain(el, ctx);
  if (!domainPt) return [];
  const p: Pt = [ctx.sx(domainPt[0]), ctx.sy(domainPt[1])];
  ctx.anchors[el.id] = p;
  const out: Drawable[] = [];
  if (el.guides) {
    out.push({
      id: `${el.id}_guides`,
      kind: "stroke",
      pts: [
        [plot.x0, p[1]],
        p,
        [p[0], plot.y0],
      ],
      z: Z_STROKE,
      style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.9 }),
      drawOpts: resolveDrawOpts(el.draw, { duration: 700 }),
    });
  }
  out.push({
    id: el.id,
    kind: "stroke",
    pts: [p],
    shapeHint: { type: "circle", c: p, r: 7 },
    z: Z_STROKE,
    style: resolveStyle(el.style, { strokeWidth: 3, fill: resolveStyle(el.style).color }),
    drawOpts: resolveDrawOpts(el.draw, { duration: 350 }),
  });
  return out;
}

function regionDrawable(el: SpecElement, ctx: Ctx): Drawable[] {
  const [aId, bId] = el.between ?? [];
  const a = ctx.curveSamples.get(aId);
  const b = ctx.curveSamples.get(bId);
  if (!a || !b) {
    ctx.warnings.push(`region "${el.id}": between references unknown curves — skipped`);
    return [];
  }
  const x0 = el.x_from ?? Math.max(Math.min(...a.map((p) => p[0])), Math.min(...b.map((p) => p[0])));
  const x1 = el.x_to ?? Math.min(Math.max(...a.map((p) => p[0])), Math.max(...b.map((p) => p[0])));
  const N = 30;
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
  if (upper.length < 2) return [];
  const pts = toLogical([...upper, ...lower.reverse()], ctx);
  const style = resolveStyle(el.style, { color: COLORS.region1, fill: el.style?.fill ?? COLORS.region1, opacity: 0.5, strokeWidth: 1 });
  ctx.anchors[el.id] = centroid(pts);
  return [
    {
      id: el.id,
      kind: "area",
      pts,
      z: Z_AREA,
      style,
      drawOpts: resolveDrawOpts(el.draw, { duration: 900 }),
    },
  ];
}

const NODE_FONT = 22;

function nodeDrawables(el: SpecElement, ctx: Ctx): Drawable[] {
  const c = ctx.anchors[el.id] ?? [CANVAS.w / 2, CANVAS.h / 2];
  const shape = el.shape ?? "circle";
  const text = el.text;
  const style = resolveStyle(el.style, { strokeWidth: 3 });
  const drawOpts = resolveDrawOpts(el.draw, { duration: 700 });
  const out: Drawable[] = [];
  const textW = text ? heuristicMeasure(text, NODE_FONT).w : 0;

  if (shape === "person") {
    const s = 34; // half-height
    const head: StrokeDrawable = {
      id: `${el.id}_head`,
      kind: "stroke",
      pts: [],
      shapeHint: { type: "circle", c: [c[0], c[1] + s * 0.6], r: s * 0.38 },
      z: Z_STROKE,
      style,
      drawOpts,
    };
    const body: StrokeDrawable = {
      id: `${el.id}_body`,
      kind: "stroke",
      pts: [
        [c[0] - s * 0.55, c[1] - s], // left leg
        [c[0], c[1] - s * 0.25],
        [c[0] + s * 0.55, c[1] - s], // right leg
        [c[0], c[1] - s * 0.25],
        [c[0], c[1] + s * 0.25], // torso
        [c[0] - s * 0.6, c[1] - s * 0.05], // left arm
        [c[0], c[1] + s * 0.25],
        [c[0] + s * 0.6, c[1] - s * 0.05], // right arm
      ],
      z: Z_STROKE,
      style,
      drawOpts,
    };
    const group: GroupDrawable = { id: el.id, kind: "group", children: [head, body], z: Z_STROKE, style, drawOpts };
    ctx.nodeRadius.set(el.id, s * 1.2);
    out.push(group);
  } else if (shape === "rect" || shape === "decision") {
    const w = shape === "decision" ? 56 : Math.max(130, textW + 36);
    const h = shape === "decision" ? 56 : 62;
    ctx.nodeRadius.set(el.id, Math.hypot(w, h) / 2);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: rectPts(c, w, h),
      closed: true,
      shapeHint: { type: "rect", x: c[0] - w / 2, y: c[1] - h / 2, w, h },
      z: Z_STROKE,
      style,
      drawOpts,
    });
  } else if (shape === "triangle" || shape === "terminal") {
    const s = 30;
    ctx.nodeRadius.set(el.id, s + 6);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: [
        [c[0] - s, c[1] + s * 0.85],
        [c[0] - s, c[1] - s * 0.85],
        [c[0] + s, c[1]],
      ],
      closed: true,
      z: Z_STROKE,
      style,
      drawOpts,
    });
  } else {
    // circle / chance
    const r = shape === "chance" ? 32 : Math.max(44, textW / 2 + 14);
    ctx.nodeRadius.set(el.id, r);
    out.push({
      id: el.id,
      kind: "stroke",
      pts: [c],
      shapeHint: { type: "circle", c, r },
      z: Z_STROKE,
      style,
      drawOpts,
    });
  }

  if (text && shape !== "person" && shape !== "terminal" && shape !== "triangle") {
    out.push(nodeText(el.id, c, text, drawOpts));
  } else if (text) {
    // text below persons/triangles
    out.push(nodeText(el.id, [c[0], c[1] - (ctx.nodeRadius.get(el.id) ?? 40) - 20], text, drawOpts));
  }
  return out;
}

function nodeText(id: string, pos: Pt, text: string, drawOpts: ReturnType<typeof resolveDrawOpts>): TextDrawable {
  return {
    id: `${id}_text`,
    kind: "text",
    pos,
    text,
    fontSize: NODE_FONT,
    anchor: "middle",
    z: Z_TEXT,
    style: defaultStyle(),
    drawOpts: { mode: drawOpts.mode, duration: Math.min(400, drawOpts.duration) },
  };
}

function rectPts(c: Pt, w: number, h: number): Pt[] {
  return [
    [c[0] - w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] - h / 2],
    [c[0] + w / 2, c[1] + h / 2],
    [c[0] - w / 2, c[1] + h / 2],
  ];
}

function resolveEnd(end: { ref?: string; x?: number; y?: number } | undefined, ctx: Ctx): Pt | null {
  if (!end) return null;
  if (end.ref) {
    const a = ctx.anchors[end.ref];
    if (!a) {
      ctx.warnings.push(`arrow/edge endpoint references unknown id "${end.ref}"`);
      return null;
    }
    return a;
  }
  if (end.x !== undefined && end.y !== undefined) {
    return ctx.domainDeclared ? [ctx.sx(end.x), ctx.sy(end.y)] : [end.x, end.y];
  }
  return null;
}

function connectorDrawable(el: SpecElement, ctx: Ctx): Drawable[] {
  const from = resolveEnd(el.from, ctx);
  const to = resolveEnd(el.to, ctx);
  if (!from || !to) return [];
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
  const ux = (to[0] - from[0]) / dist;
  const uy = (to[1] - from[1]) / dist;
  const rFrom = el.from?.ref ? (ctx.nodeRadius.get(el.from.ref) ?? 10) + 4 : 0;
  const rTo = el.to?.ref ? (ctx.nodeRadius.get(el.to.ref) ?? 10) + 4 : 0;
  const a: Pt = [from[0] + ux * rFrom, from[1] + uy * rFrom];
  const b: Pt = [to[0] - ux * rTo, to[1] - uy * rTo];
  let pts: Pt[];
  if (el.curved) {
    const mid: Pt = [(a[0] + b[0]) / 2 - uy * dist * 0.18, (a[1] + b[1]) / 2 + ux * dist * 0.18];
    pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const x = (1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * mid[0] + t * t * b[0];
      const y = (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * mid[1] + t * t * b[1];
      pts.push([x, y]);
    }
  } else {
    pts = [a, b];
  }
  ctx.anchors[el.id] = pts[Math.floor(pts.length / 2)];
  return [
    {
      id: el.id,
      kind: "stroke",
      pts,
      arrowhead: el.type === "arrow" ? "end" : undefined,
      z: Z_STROKE,
      style: resolveStyle(el.style, { strokeWidth: el.type === "arrow" ? 3 : 2.5 }),
      drawOpts: resolveDrawOpts(el.draw, { duration: 600 }),
    },
  ];
}

function shapeDrawable(el: SpecElement, ctx: Ctx): StrokeDrawable {
  const style = resolveStyle(el.style);
  const drawOpts = resolveDrawOpts(el.draw, { duration: 700 });
  const shape = el.shape ?? "rect";
  if (shape === "circle" || shape === "chance") {
    const c: Pt = [el.x ?? CANVAS.w / 2, el.y ?? CANVAS.h / 2];
    const r = el.radius ?? 40;
    ctx.anchors[el.id] = c;
    return { id: el.id, kind: "stroke", pts: [c], shapeHint: { type: "circle", c, r }, z: Z_STROKE, style, drawOpts };
  }
  // rect (x,y = lower-left corner in logical units)
  const x = el.x ?? 100;
  const y = el.y ?? 100;
  const w = el.width ?? 160;
  const h = el.height ?? 100;
  ctx.anchors[el.id] = [x + w / 2, y + h / 2];
  return {
    id: el.id,
    kind: "stroke",
    pts: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    closed: true,
    shapeHint: { type: "rect", x, y, w, h },
    z: Z_STROKE,
    style,
    drawOpts,
  };
}
