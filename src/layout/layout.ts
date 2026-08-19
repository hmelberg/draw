// The layout orchestrator: spec → backend-independent drawables + lint.
// Template routing failures fall through to tier-2 gracefully (never hard-fail).

import { scenes } from "../scenes/registry";
import { normalizeSpec } from "../spec/schema";
import type { Spec } from "../spec/types";
import { lintLayout, type LintIssue } from "../lint/lint";
import { layoutElements } from "./tier2";
import { placeLabels, type LabelRequest } from "./labels";
import { bboxOfPts, bboxOfText, expandBox, type BBox } from "./geometry";
import { heuristicMeasure, type MeasureFn } from "./measure";
import { drawablesForId, leafDrawables, type Drawable, type Pt } from "./model";
import { linearScale, plotArea } from "./canvas";

export interface LayoutResult {
  drawables: Drawable[];
  /** Command-addressable element ids in natural draw order. */
  order: string[];
  issues: LintIssue[];
  warnings: string[];
}

export function layoutSpec(rawSpec: Spec, measure: MeasureFn = heuristicMeasure): LayoutResult {
  const spec = normalizeSpec(rawSpec) as Spec;
  const warnings: string[] = [];
  const drawables: Drawable[] = [];
  const labelRequests: LabelRequest[] = [];
  const order: string[] = [];
  let seedAnchors: Record<string, Pt> = {};

  if (spec.template) {
    const scene = scenes[spec.template];
    if (!scene) {
      warnings.push(`unknown template "${spec.template}" — falling through to tier-2 elements`);
    } else if (!scene.layout) {
      warnings.push(`template "${spec.template}" is a stub — falling through to tier-2 elements`);
    } else {
      try {
        const sceneLayout = scene.layout(spec.params ?? {});
        drawables.push(...sceneLayout.drawables);
        labelRequests.push(...sceneLayout.labels);
        order.push(...sceneLayout.order);
        seedAnchors = sceneLayout.anchors;
      } catch (err) {
        warnings.push(`template "${spec.template}" layout failed (${(err as Error).message}) — falling through to tier-2 elements`);
      }
    }
  }

  if (spec.elements && spec.elements.length > 0) {
    const tier2 = layoutElements(spec.elements, spec.domain, seedAnchors);
    drawables.push(...tier2.drawables);
    labelRequests.push(...tier2.labels);
    warnings.push(...tier2.warnings);
    for (const el of spec.elements) {
      if (!order.includes(el.id)) order.push(el.id);
    }
  }

  // Label placement against everything drawn so far.
  const obstacles = obstacleBoxes(drawables, measure);
  const placed = placeLabels(labelRequests, obstacles, measure);
  for (const p of placed) {
    if (p.leader) drawables.push(p.leader);
    drawables.push(p.text);
  }
  for (const req of labelRequests) {
    if (!order.includes(req.id)) order.push(req.id);
  }

  const issues = lintLayout(drawables, measure);
  return { drawables, order, issues, warnings };
}

/** Union bbox per command-addressable element id (logical units), for the gesture verbs. */
export function elementBBoxes(layout: LayoutResult, measure: MeasureFn = heuristicMeasure): Map<string, BBox> {
  const map = new Map<string, BBox>();
  for (const id of layout.order) {
    const boxes: BBox[] = [];
    for (const d of leafDrawables(drawablesForId(layout.drawables, id))) {
      if (d.kind === "text") {
        boxes.push(bboxOfText(d, measure));
      } else if (d.kind === "stroke" && d.shapeHint?.type === "circle") {
        const { c, r } = d.shapeHint;
        boxes.push({ x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r });
      } else if (d.kind === "stroke" && d.shapeHint?.type === "rect") {
        boxes.push({ x: d.shapeHint.x, y: d.shapeHint.y, w: d.shapeHint.w, h: d.shapeHint.h });
      } else if (d.pts.length > 0) {
        boxes.push(bboxOfPts(d.pts));
      }
    }
    if (boxes.length === 0) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of boxes) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    map.set(id, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  return map;
}

/**
 * Domain → logical mappings for the gesture verbs, matching tier-2's
 * convention: coordinates are mapped only when a domain is declared.
 */
export function domainMapping(domain: Spec["domain"]): { toLogical: (p: Pt) => Pt; deltaToLogical: (d: Pt) => Pt } {
  if (!domain) return { toLogical: (p) => p, deltaToLogical: (d) => d };
  const plot = plotArea();
  const dx = domain.x ?? [0, 100];
  const dy = domain.y ?? [0, 100];
  const sx = linearScale(dx, [plot.x0, plot.x1]);
  const sy = linearScale(dy, [plot.y0, plot.y1]);
  const fx = (plot.x1 - plot.x0) / (dx[1] - dx[0] || 1);
  const fy = (plot.y1 - plot.y0) / (dy[1] - dy[0] || 1);
  return {
    toLogical: ([x, y]) => [sx(x), sy(y)],
    deltaToLogical: ([a, b]) => [a * fx, b * fy],
  };
}

function obstacleBoxes(drawables: Drawable[], measure: MeasureFn): BBox[] {
  const boxes: BBox[] = [];
  for (const d of leafDrawables(drawables)) {
    if (d.kind === "text") {
      boxes.push(expandBox(bboxOfText(d, measure), 2));
    } else if (d.kind === "stroke") {
      if (d.shapeHint?.type === "circle") {
        const { c, r } = d.shapeHint;
        boxes.push({ x: c[0] - r, y: c[1] - r, w: 2 * r, h: 2 * r });
      } else if (d.shapeHint?.type === "rect") {
        boxes.push({ x: d.shapeHint.x, y: d.shapeHint.y, w: d.shapeHint.w, h: d.shapeHint.h });
      } else {
        // Per-segment boxes: keeps long thin curves from blocking half the canvas.
        const pad = d.style.strokeWidth;
        for (let i = 0; i + 1 < d.pts.length; i++) {
          boxes.push(expandBox(bboxOfPts([d.pts[i], d.pts[i + 1]]), pad));
        }
      }
    }
    // areas are not obstacles: region labels belong inside their region
  }
  return boxes;
}
