// The custom-svg backend (primary): rough.js hand-drawn rendering with
// dash-offset progressive drawing. Consumes the layout IR; applies the single
// y-flip at emission time.

import rough from "roughjs";
import type { RoughSVG } from "roughjs/bin/svg";
import type { Options as RoughOptions } from "roughjs/bin/core";
import { CANVAS, toSvgY } from "../layout/canvas";
import {
  drawablesForId,
  leafDrawables,
  type AreaDrawable,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../layout/model";
import { heuristicMeasure, type MeasureFn } from "../layout/measure";
import type { LayoutResult } from "../layout/layout";
import type { BackendModule, MountResult, RenderedElement } from "./backend";

export const SKETCH_FONT = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Canvas-based text measurement matching the sketch font; heuristic fallback. */
export function makeBrowserMeasure(): MeasureFn {
  if (typeof document === "undefined") return heuristicMeasure;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return heuristicMeasure;
  const cache = new Map<string, { w: number; h: number }>();
  return (text, fontSize) => {
    const key = `${fontSize}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    ctx.font = `${fontSize}px ${SKETCH_FONT}`;
    const m = ctx.measureText(text);
    const result = { w: m.width, h: fontSize * 1.25 };
    cache.set(key, result);
    return result;
  };
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 2147483646 + 1;
}

function pathFromPts(pts: Pt[], closed?: boolean): string {
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${toSvgY(y).toFixed(1)}`).join(" ");
  return closed ? `${d} Z` : d;
}

/** Geometric dashes (M/L subpaths) so dash-offset reveal still works on dashed strokes. */
function dashedPathFromPts(pts: Pt[], dash = 11, gap = 9): string {
  const parts: string[] = [];
  let carry = 0;
  let drawing = true;
  for (let i = 0; i + 1 < pts.length; i++) {
    let [x, y] = pts[i];
    const [x1, y1] = pts[i + 1];
    let segLen = Math.hypot(x1 - x, y1 - y);
    const ux = (x1 - x) / (segLen || 1);
    const uy = (y1 - y) / (segLen || 1);
    while (segLen > 0) {
      const need = (drawing ? dash : gap) - carry;
      const step = Math.min(need, segLen);
      const nx = x + ux * step;
      const ny = y + uy * step;
      if (drawing) parts.push(`M${x.toFixed(1)} ${toSvgY(y).toFixed(1)} L${nx.toFixed(1)} ${toSvgY(ny).toFixed(1)}`);
      x = nx;
      y = ny;
      segLen -= step;
      carry += step;
      if (carry >= (drawing ? dash : gap) - 1e-6) {
        carry = 0;
        drawing = !drawing;
      }
    }
  }
  return parts.join(" ");
}

function arrowheadPts(pts: Pt[], at: "end" | "start"): [Pt, Pt, Pt] | null {
  if (pts.length < 2) return null;
  const [tip, prev] = at === "end" ? [pts[pts.length - 1], pts[pts.length - 2]] : [pts[0], pts[1]];
  const dx = tip[0] - prev[0];
  const dy = tip[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const size = 13;
  const spread = 0.45;
  const left: Pt = [tip[0] - size * (ux * Math.cos(spread) - uy * Math.sin(spread)), tip[1] - size * (uy * Math.cos(spread) + ux * Math.sin(spread))];
  const right: Pt = [tip[0] - size * (ux * Math.cos(spread) + uy * Math.sin(spread)), tip[1] - size * (uy * Math.cos(spread) - ux * Math.sin(spread))];
  return [left, tip, right];
}

function roughOpts(d: StrokeDrawable | AreaDrawable, extra: Partial<RoughOptions> = {}): RoughOptions {
  return {
    roughness: d.style.roughness,
    stroke: d.style.color,
    strokeWidth: d.style.strokeWidth,
    seed: hashSeed(d.id),
    bowing: 0.9,
    ...extra,
  };
}

function drawLeaf(rc: RoughSVG, d: Exclude<Drawable, { kind: "group" }>): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.dataset.leafId = d.id;
  if (d.kind === "text") {
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", String(d.pos[0]));
    t.setAttribute("y", String(toSvgY(d.pos[1])));
    t.setAttribute("fill", d.style.color);
    t.setAttribute("font-size", String(d.fontSize));
    t.setAttribute("font-family", SKETCH_FONT);
    t.setAttribute("text-anchor", d.anchor === "middle" ? "middle" : d.anchor);
    t.setAttribute("dominant-baseline", "central");
    if (d.style.opacity < 1) t.setAttribute("opacity", String(d.style.opacity));
    t.textContent = d.text;
    g.appendChild(t);
    return g;
  }
  if (d.kind === "area") {
    const node = rc.polygon(
      d.pts.map(([x, y]) => [x, toSvgY(y)]),
      roughOpts(d, { fill: d.style.fill ?? d.style.color, fillStyle: "hachure", hachureGap: 7, strokeWidth: 1 }),
    );
    node.setAttribute("opacity", String(d.style.opacity));
    g.appendChild(node);
    return g;
  }
  // stroke
  const opts = roughOpts(d);
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const node = rc.circle(c[0], toSvgY(c[1]), r * 2, d.style.fill ? { ...opts, fill: d.style.fill, fillStyle: "solid" } : opts);
    g.appendChild(node);
  } else if (d.shapeHint?.type === "rect") {
    const node = rc.rectangle(d.shapeHint.x, toSvgY(d.shapeHint.y + d.shapeHint.h), d.shapeHint.w, d.shapeHint.h, opts);
    g.appendChild(node);
  } else if (d.pts.length >= 2) {
    const dStr = d.style.dash ? dashedPathFromPts(d.pts) : pathFromPts(d.pts, d.closed);
    g.appendChild(rc.path(dStr, opts));
  }
  if (d.kind === "stroke" && d.arrowhead && d.pts.length >= 2) {
    const heads: ("end" | "start")[] = d.arrowhead === "both" ? ["start", "end"] : [d.arrowhead];
    for (const at of heads) {
      const tri = arrowheadPts(d.pts, at);
      if (tri) g.appendChild(rc.linearPath(tri.map(([x, y]) => [x, toSvgY(y)] as [number, number]), opts));
    }
  }
  if (d.style.opacity < 1 && d.kind === "stroke") g.setAttribute("opacity", String(d.style.opacity));
  return g;
}

interface LeafHandle {
  durationMs: number;
  prepare(): void;
  setProgress(t: number): void;
}

function makeLeafHandle(g: SVGGElement, leaf: Exclude<Drawable, { kind: "group" }>): LeafHandle {
  if (leaf.kind === "text") {
    return {
      durationMs: leaf.drawOpts.duration,
      prepare: () => {
        g.style.opacity = "0";
      },
      setProgress: (t) => {
        const base = leaf.style.opacity;
        g.style.opacity = String(base * t);
      },
    };
  }
  let paths: { el: SVGPathElement; len: number; hasFill: boolean }[] | null = null;
  let total = 0;
  const ensure = () => {
    if (paths) return;
    paths = [];
    for (const p of Array.from(g.querySelectorAll("path"))) {
      const len = p.getTotalLength();
      // Solid fills are not hidden by dash-offset; fade them with progress.
      const hasFill = (p.getAttribute("fill") ?? "none") !== "none";
      paths.push({ el: p, len, hasFill });
      total += len;
    }
  };
  return {
    durationMs: leaf.drawOpts.duration,
    prepare: () => {
      ensure();
      for (const { el, len, hasFill } of paths!) {
        el.style.strokeDasharray = `${len}`;
        el.style.strokeDashoffset = `${len}`;
        if (hasFill) el.style.fillOpacity = "0";
      }
    },
    setProgress: (t) => {
      ensure();
      let elapsed = t * total;
      for (const { el, len, hasFill } of paths!) {
        const local = Math.min(Math.max(elapsed, 0), len);
        el.style.strokeDashoffset = `${len - local}`;
        if (hasFill) el.style.fillOpacity = String(len > 0 ? local / len : t);
        elapsed -= len;
      }
    },
  };
}

class SvgElementHandle implements RenderedElement {
  readonly id: string;
  readonly durationMs: number;
  private leaves: LeafHandle[];
  private cumulative: number[];

  constructor(id: string, leaves: LeafHandle[]) {
    this.id = id;
    this.leaves = leaves;
    this.cumulative = [];
    let acc = 0;
    for (const l of leaves) {
      this.cumulative.push(acc);
      acc += l.durationMs;
    }
    this.durationMs = acc;
    leaves.forEach((l) => l.prepare());
  }

  setProgress(t: number): void {
    const elapsed = t * this.durationMs;
    this.leaves.forEach((leaf, i) => {
      if (this.durationMs === 0) {
        leaf.setProgress(t >= 1 ? 1 : 0);
        return;
      }
      if (leaf.durationMs === 0) {
        leaf.setProgress(elapsed >= this.cumulative[i] && t > 0 ? 1 : 0);
      } else {
        const local = (elapsed - this.cumulative[i]) / leaf.durationMs;
        leaf.setProgress(Math.min(Math.max(local, 0), 1));
      }
    });
    if (t >= 1) this.leaves.forEach((l) => l.setProgress(1));
  }

  finish(): void {
    this.setProgress(1);
  }

  hide(): void {
    this.leaves.forEach((l) => l.setProgress(0));
  }
}

export const customSvgBackend: BackendModule = {
  name: "custom-svg",
  label: "Custom SVG (rough.js)",
  description: "Hand-rolled SVG with rough.js sketchiness and dash-offset progressive drawing.",
  supportsAnimation: true,
  appliesTo: () => true,
  async mount(layout: LayoutResult, _spec, container: HTMLElement): Promise<MountResult> {
    const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("viewBox", `0 0 ${CANVAS.w} ${CANVAS.h}`);
    svg.setAttribute("class", "cs-svg");
    const rc = rough.svg(svg);

    const layers = { 0: document.createElementNS(SVG_NS, "g"), 1: document.createElementNS(SVG_NS, "g"), 2: document.createElementNS(SVG_NS, "g") };
    svg.append(layers[0], layers[1], layers[2]);

    // Paint order: z layer, then IR order within the layer.
    const leafNodes = new Map<string, { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[]>();
    for (const id of layout.order) {
      const parts = drawablesForId(layout.drawables, id);
      const leaves = leafDrawables(parts);
      const entry: { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[] = [];
      for (const leaf of leaves) {
        const g = drawLeaf(rc, leaf);
        const z = (leaf.z <= 0 ? 0 : leaf.z === 1 ? 1 : 2) as 0 | 1 | 2;
        layers[z].appendChild(g);
        entry.push({ g, leaf });
      }
      leafNodes.set(id, entry);
    }

    container.appendChild(svg);

    // Handles need the nodes in the DOM (getTotalLength).
    const elements = new Map<string, RenderedElement>();
    for (const [id, entry] of leafNodes) {
      elements.set(id, new SvgElementHandle(id, entry.map(({ g, leaf }) => makeLeafHandle(g, leaf))));
    }

    return {
      elements,
      destroy: () => svg.remove(),
    };
  },
};
