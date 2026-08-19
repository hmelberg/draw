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
import type { BBox } from "../layout/geometry";
import type { HighlightEffect } from "../spec/types";
import type { BackendEffects, BackendModule, MountResult, RenderedElement } from "./backend";

export const SKETCH_FONT = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Canvas-based text measurement matching the sketch font; heuristic fallback.
 * Until the webfont is actually loaded we measure conservatively and skip the
 * cache — otherwise fallback-font widths get cached and labels rendered in the
 * real (wider) font stick out past the canvas edge.
 */
export function makeBrowserMeasure(): MeasureFn {
  if (typeof document === "undefined") return heuristicMeasure;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return heuristicMeasure;
  const cache = new Map<string, { w: number; h: number }>();
  let fontReady = false;
  return (text, fontSize) => {
    if (!fontReady) {
      try {
        fontReady = document.fonts?.check?.(`${fontSize}px 'Patrick Hand'`) ?? false;
      } catch {
        fontReady = false;
      }
    }
    const key = `${fontSize}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    ctx.font = `${fontSize}px ${SKETCH_FONT}`;
    let w = ctx.measureText(text).width;
    if (!fontReady) w = Math.max(w, heuristicMeasure(text, fontSize).w) * 1.06;
    // small safety margin against font rendering variance
    const result = { w: w * 1.03 + 2, h: fontSize * 1.25 };
    if (fontReady) cache.set(key, result);
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

// ---- clean (non-rough) rendering: same drawables, crisp single paths ----
// Everything stays a <path> so the dash-offset reveal works identically.

function circlePath(cx: number, cySvg: number, r: number): string {
  return `M${(cx - r).toFixed(1)} ${cySvg.toFixed(1)} A${r} ${r} 0 1 0 ${(cx + r).toFixed(1)} ${cySvg.toFixed(1)} A${r} ${r} 0 1 0 ${(cx - r).toFixed(1)} ${cySvg.toFixed(1)}`;
}

function plainPath(d: string, style: { color: string; strokeWidth: number; fill?: string; opacity?: number }, filled = false): SVGPathElement {
  const p = document.createElementNS(SVG_NS, "path") as SVGPathElement;
  p.setAttribute("d", d);
  p.setAttribute("stroke", style.color);
  p.setAttribute("stroke-width", String(style.strokeWidth));
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  p.setAttribute("fill", filled && style.fill ? style.fill : "none");
  return p;
}

function drawLeafClean(g: SVGGElement, d: Exclude<Drawable, { kind: "group" | "text" }>): void {
  if (d.kind === "area") {
    const p = plainPath(pathFromPts(d.pts, true), { ...d.style, strokeWidth: 1.5 }, true);
    p.setAttribute("fill", d.style.fill ?? d.style.color);
    p.setAttribute("fill-opacity", "0.45");
    p.setAttribute("opacity", String(d.style.opacity));
    g.appendChild(p);
    return;
  }
  const filled = !!d.style.fill;
  if (d.shapeHint?.type === "circle") {
    const { c, r } = d.shapeHint;
    const p = plainPath(circlePath(c[0], toSvgY(c[1]), r), d.style, filled);
    if (filled) p.setAttribute("fill", d.style.fill!);
    g.appendChild(p);
  } else if (d.shapeHint?.type === "rect") {
    const { x, y, w, h: rh } = d.shapeHint;
    const top = toSvgY(y + rh);
    g.appendChild(plainPath(`M${x} ${top} h${w} v${rh} h${-w} Z`, d.style));
  } else if (d.pts.length >= 2) {
    const dStr = d.style.dash ? dashedPathFromPts(d.pts) : pathFromPts(d.pts, d.closed);
    g.appendChild(plainPath(dStr, d.style));
  }
  if (d.arrowhead && d.pts.length >= 2) {
    const heads: ("end" | "start")[] = d.arrowhead === "both" ? ["start", "end"] : [d.arrowhead];
    for (const at of heads) {
      const tri = arrowheadPts(d.pts, at);
      if (tri) g.appendChild(plainPath(pathFromPts(tri), d.style));
    }
  }
  if (d.style.opacity < 1) g.setAttribute("opacity", String(d.style.opacity));
}

function drawLeaf(rc: RoughSVG | null, d: Exclude<Drawable, { kind: "group" }>): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.dataset.leafId = d.id;
  if (d.kind === "text") {
    const t = document.createElementNS(SVG_NS, "text");
    const x = d.pos[0];
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(toSvgY(d.pos[1])));
    t.setAttribute("fill", d.style.color);
    t.setAttribute("font-size", String(d.fontSize));
    t.setAttribute("font-family", SKETCH_FONT);
    t.setAttribute("text-anchor", d.anchor === "middle" ? "middle" : d.anchor);
    t.setAttribute("dominant-baseline", "central");
    if (d.style.opacity < 1) t.setAttribute("opacity", String(d.style.opacity));
    if (d.lines && d.lines.length > 1) {
      const lineH = d.fontSize * 1.25;
      d.lines.forEach((line, i) => {
        const span = document.createElementNS(SVG_NS, "tspan");
        span.setAttribute("x", String(x));
        span.setAttribute("dy", String(i === 0 ? -((d.lines!.length - 1) / 2) * lineH : lineH));
        span.textContent = line;
        t.appendChild(span);
      });
    } else {
      t.textContent = d.text;
    }
    g.appendChild(t);
    return g;
  }
  if (!rc) {
    drawLeafClean(g, d);
    return g;
  }
  if (d.kind === "area") {
    // Dense, heavy hachure — thin sparse fills read as unshaded on some screens.
    const node = rc.polygon(
      d.pts.map(([x, y]) => [x, toSvgY(y)]),
      roughOpts(d, { fill: d.style.fill ?? d.style.color, fillStyle: "hachure", hachureGap: 5.5, fillWeight: 1.7, strokeWidth: 1.8 }),
    );
    node.setAttribute("opacity", String(Math.min(1, d.style.opacity + 0.15)));
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
  private groups: SVGGElement[];

  constructor(id: string, leaves: LeafHandle[], groups: SVGGElement[]) {
    this.id = id;
    this.leaves = leaves;
    this.groups = groups;
    this.cumulative = [];
    let acc = 0;
    for (const l of leaves) {
      this.cumulative.push(acc);
      acc += l.durationMs;
    }
    this.durationMs = acc;
    leaves.forEach((l) => l.prepare());
  }

  /** Persistent translation, logical units y-up (the y-flip happens here). */
  setOffset(dx: number, dy: number): void {
    for (const g of this.groups) {
      if (dx === 0 && dy === 0) g.removeAttribute("transform");
      else g.setAttribute("transform", `translate(${dx.toFixed(1)} ${(-dy).toFixed(1)})`);
    }
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

/**
 * Last-line defense against text clipping at the canvas border: after render
 * (and again once webfonts finish loading), shift any overflowing <text> back
 * inside the viewBox. Purely visual; layout/lint boxes are unchanged.
 */
function nudgeTextsIntoCanvas(svg: SVGSVGElement): void {
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    try {
      // Our backend never sets transforms on text otherwise, so recomputing
      // from a clean slate keeps repeated calls (e.g. after fonts load) idempotent.
      t.removeAttribute("transform");
      const bb = (t as SVGTextElement).getBBox();
      let dx = 0;
      const overRight = bb.x + bb.width - (CANVAS.w - 3);
      if (overRight > 0) dx = -overRight;
      else if (bb.x < 3) dx = 3 - bb.x;
      let dy = 0;
      if (bb.y < 3) dy = 3 - bb.y;
      else if (bb.y + bb.height > CANVAS.h - 3) dy = CANVAS.h - 3 - (bb.y + bb.height);
      if (dx !== 0 || dy !== 0) {
        t.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      }
    } catch {
      // getBBox throws on detached/hidden nodes — nothing to fix then
    }
  }
}

// ---- gesture-verb effects: stateless per-frame primitives on an overlay ----

const HIGHLIGHT_COLOR = "#cf4632";
const LASER_COLOR = "#d33827";

/** Colored echo of an element's rendered nodes, used by pulse/glow. */
function emphasisClone(g: SVGGElement, color: string, glow: boolean): SVGGElement {
  const c = g.cloneNode(true) as SVGGElement;
  c.removeAttribute("opacity");
  c.style.opacity = "0";
  c.style.pointerEvents = "none";
  for (const p of Array.from(c.querySelectorAll("path"))) {
    p.setAttribute("stroke", color);
    if ((p.getAttribute("fill") ?? "none") !== "none") p.setAttribute("fill", color);
    const w = parseFloat(p.getAttribute("stroke-width") ?? "3") || 3;
    p.setAttribute("stroke-width", String(w + 1.5));
  }
  for (const t of Array.from(c.querySelectorAll("text"))) t.setAttribute("fill", color);
  if (glow) c.style.filter = `drop-shadow(0 0 9px ${color})`;
  return c;
}

function ellipseRingPath(box: BBox, color: string, rc: RoughSVG | null): SVGGElement {
  const cx = box.x + box.w / 2;
  const cy = toSvgY(box.y + box.h / 2);
  const rx = box.w / 2 + 22;
  const ry = box.h / 2 + 18;
  const g = document.createElementNS(SVG_NS, "g") as SVGGElement;
  g.style.pointerEvents = "none";
  if (rc) {
    g.appendChild(rc.ellipse(cx, cy, rx * 2, ry * 2, { stroke: color, strokeWidth: 3.5, roughness: 1.6, fill: undefined, seed: 7 }));
  } else {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}`);
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", "3.5");
    p.setAttribute("fill", "none");
    g.appendChild(p);
  }
  return g;
}

interface HighlightNodes {
  nodes: SVGGElement[];
  ringPaths: { el: SVGPathElement; len: number }[];
}

function makeEffects(
  svg: SVGSVGElement,
  overlay: SVGGElement,
  leafNodes: Map<string, { g: SVGGElement; leaf: Exclude<Drawable, { kind: "group" }> }[]>,
  rc: RoughSVG | null,
): BackendEffects {
  const active = new Map<string, HighlightNodes>();
  const keyOf = (ids: string[]) => ids.join("|");
  let pointer: SVGGElement | null = null;

  const removeHighlight = (key: string) => {
    const st = active.get(key);
    if (!st) return;
    st.nodes.forEach((n) => n.remove());
    active.delete(key);
  };

  return {
    setHighlight(ids: string[], effect: HighlightEffect, t: number, box: BBox | null, color?: string): void {
      const col = color ?? HIGHLIGHT_COLOR;
      const key = keyOf(ids);
      // A circle without a box degrades to a pulse.
      const kind: HighlightEffect = effect === "circle" && !box ? "pulse" : effect;
      let st = active.get(key);
      if (!st) {
        st = { nodes: [], ringPaths: [] };
        if (kind === "circle") {
          const ring = ellipseRingPath(box!, col, rc);
          overlay.appendChild(ring);
          st.nodes.push(ring);
          for (const p of Array.from(ring.querySelectorAll("path"))) {
            const len = p.getTotalLength();
            p.style.strokeDasharray = `${len}`;
            p.style.strokeDashoffset = `${len}`;
            st.ringPaths.push({ el: p, len });
          }
        } else {
          for (const id of ids) {
            for (const { g } of leafNodes.get(id) ?? []) {
              const clone = emphasisClone(g, col, kind === "glow");
              overlay.appendChild(clone);
              st.nodes.push(clone);
            }
          }
        }
        active.set(key, st);
      }
      if (t >= 1) {
        removeHighlight(key);
        return;
      }
      if (kind === "circle") {
        const reveal = Math.min(t / 0.3, 1);
        const fade = t < 0.78 ? 1 : 1 - (t - 0.78) / 0.22;
        for (const { el, len } of st.ringPaths) el.style.strokeDashoffset = `${len * (1 - reveal)}`;
        st.nodes.forEach((n) => (n.style.opacity = String(0.95 * fade)));
      } else if (kind === "glow") {
        const swell = Math.sin(Math.PI * t);
        st.nodes.forEach((n) => (n.style.opacity = String(0.7 * swell)));
      } else {
        // pulse: three throbs of the colored echo
        const phase = Math.sin(Math.PI * t * 3) ** 2;
        st.nodes.forEach((n) => (n.style.opacity = String(0.8 * phase)));
      }
    },

    endHighlight(ids: string[]): void {
      removeHighlight(keyOf(ids));
    },

    setPointer(p: Pt | null): void {
      if (!p) {
        pointer?.setAttribute("display", "none");
        return;
      }
      if (!pointer) {
        pointer = document.createElementNS(SVG_NS, "g") as SVGGElement;
        pointer.style.pointerEvents = "none";
        const halo = document.createElementNS(SVG_NS, "circle");
        halo.setAttribute("r", "11");
        halo.setAttribute("fill", LASER_COLOR);
        halo.setAttribute("opacity", "0.28");
        const core = document.createElementNS(SVG_NS, "circle");
        core.setAttribute("r", "4.5");
        core.setAttribute("fill", LASER_COLOR);
        pointer.append(halo, core);
        overlay.appendChild(pointer);
      }
      pointer.removeAttribute("display");
      pointer.setAttribute("transform", `translate(${p[0].toFixed(1)} ${toSvgY(p[1]).toFixed(1)})`);
    },

    setCamera(box: BBox | null): void {
      if (!box) svg.setAttribute("viewBox", `0 0 ${CANVAS.w} ${CANVAS.h}`);
      else svg.setAttribute("viewBox", `${box.x.toFixed(1)} ${toSvgY(box.y + box.h).toFixed(1)} ${box.w.toFixed(1)} ${box.h.toFixed(1)}`);
    },
  };
}

function makeSvgBackend(opts: { name: string; label: string; description: string; sketchy: boolean }): BackendModule {
  return {
    name: opts.name,
    label: opts.label,
    description: opts.description,
    supportsAnimation: true,
    appliesTo: () => true,
    async mount(layout: LayoutResult, _spec, container: HTMLElement): Promise<MountResult> {
      const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
      svg.setAttribute("viewBox", `0 0 ${CANVAS.w} ${CANVAS.h}`);
      svg.setAttribute("class", "cs-svg");
      const rc = opts.sketchy ? rough.svg(svg) : null;

      const layers = { 0: document.createElementNS(SVG_NS, "g"), 1: document.createElementNS(SVG_NS, "g"), 2: document.createElementNS(SVG_NS, "g") };
      // Overlay for gesture effects (highlight echoes, laser pointer) — always on top.
      const overlay = document.createElementNS(SVG_NS, "g") as SVGGElement;
      overlay.setAttribute("class", "cs-overlay");
      svg.append(layers[0], layers[1], layers[2], overlay);

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
      nudgeTextsIntoCanvas(svg);
      document.fonts?.ready?.then(() => {
        if (svg.isConnected) nudgeTextsIntoCanvas(svg);
      });

      // Handles need the nodes in the DOM (getTotalLength).
      const elements = new Map<string, RenderedElement>();
      for (const [id, entry] of leafNodes) {
        elements.set(id, new SvgElementHandle(id, entry.map(({ g, leaf }) => makeLeafHandle(g, leaf)), entry.map(({ g }) => g)));
      }

      return {
        elements,
        effects: makeEffects(svg, overlay, leafNodes, rc),
        destroy: () => svg.remove(),
      };
    },
  };
}

export const customSvgBackend = makeSvgBackend({
  name: "custom-svg",
  label: "Custom SVG (rough.js)",
  description: "Hand-rolled SVG with rough.js sketchiness and dash-offset progressive drawing.",
  sketchy: true,
});

export const cleanSvgBackend = makeSvgBackend({
  name: "clean-svg",
  label: "Clean SVG (no sketch)",
  description: "The same renderer and animation without the hand-drawn styling: crisp lines, solid fills.",
  sketchy: false,
});
