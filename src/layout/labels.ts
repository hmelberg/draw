// Greedy label placement: try the preferred side, then the other candidate
// sides at increasing radii; add a leader line when the label ends up far from
// its anchor; fall back to the preferred spot (lint will flag it).

import { CANVAS } from "./canvas";
import { bboxOfText, boxesOverlap, type BBox } from "./geometry";
import {
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  COLORS,
  type DrawResolved,
  type Pt,
  type ResolvedStyle,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";
import type { MeasureFn } from "./measure";
import type { Side } from "../spec/types";

export type { Side };

export interface LabelRequest {
  id: string;
  anchor: Pt;
  side: Side;
  text: string;
  fontSize: number;
  style: ResolvedStyle;
  drawOpts: DrawResolved;
}

export interface PlacedLabel {
  text: TextDrawable;
  leader?: StrokeDrawable;
}

const DIRS: Record<Side, [number, number]> = {
  above: [0, 1],
  below: [0, -1],
  left: [-1, 0],
  right: [1, 0],
  "above-left": [-0.75, 0.75],
  "above-right": [0.75, 0.75],
  "below-left": [-0.75, -0.75],
  "below-right": [0.75, -0.75],
};

const FALLBACK_ORDER: Side[] = [
  "above-right",
  "below-right",
  "above-left",
  "below-left",
  "above",
  "below",
  "right",
  "left",
];

const EDGE_PAD = 4;
/** Wrap labels wider than this many logical units into multiple lines. */
const MAX_LABEL_WIDTH = 280;
const LINE_HEIGHT = 1.25;

function wrapLines(text: string, fontSize: number, measure: MeasureFn): string[] {
  if (measure(text, fontSize).w <= MAX_LABEL_WIDTH) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, fontSize).w > MAX_LABEL_WIDTH) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function candidateBox(anchor: Pt, side: Side, r: number, w: number, h: number): BBox {
  const [dx, dy] = DIRS[side];
  const cx = anchor[0] + dx * (r + (dx !== 0 ? w / 2 : 0));
  const cy = anchor[1] + dy * (r + (dy !== 0 ? h / 2 : 0));
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function clampToCanvas(b: BBox): BBox {
  const x = Math.min(Math.max(b.x, EDGE_PAD), CANVAS.w - b.w - EDGE_PAD);
  const y = Math.min(Math.max(b.y, EDGE_PAD), CANVAS.h - b.h - EDGE_PAD);
  return { ...b, x, y };
}

export function placeLabels(requests: LabelRequest[], obstacles: BBox[], measure: MeasureFn): PlacedLabel[] {
  const blocked: BBox[] = [...obstacles];
  const placed: PlacedLabel[] = [];

  for (const req of requests) {
    const lines = wrapLines(req.text, req.fontSize, measure);
    const w = Math.max(...lines.map((line) => measure(line, req.fontSize).w));
    const h = lines.length * req.fontSize * LINE_HEIGHT;
    const sides: Side[] = [req.side, ...FALLBACK_ORDER.filter((s) => s !== req.side)];
    const r0 = 10 + req.fontSize * 0.55;
    const rings = [1, 2.2, 3.6, 6, 9, 13].map((k) => r0 * k);

    let chosen: { box: BBox; ringIndex: number } | null = null;
    outer: for (const [ringIndex, r] of rings.entries()) {
      for (const side of sides) {
        const box = clampToCanvas(candidateBox(req.anchor, side, r, w, h));
        const collides = blocked.some((o) => boxesOverlap(box, o, 3));
        if (!collides) {
          chosen = { box, ringIndex };
          break outer;
        }
      }
    }

    // Nothing fits anywhere: keep the preferred spot and let lint report it.
    const finalBox = chosen?.box ?? clampToCanvas(candidateBox(req.anchor, req.side, rings[0], w, h));
    blocked.push(finalBox);

    const text: TextDrawable = {
      id: req.id,
      kind: "text",
      pos: [finalBox.x + finalBox.w / 2, finalBox.y + finalBox.h / 2],
      text: req.text,
      lines: lines.length > 1 ? lines : undefined,
      fontSize: req.fontSize,
      anchor: "middle",
      z: Z_TEXT,
      style: req.style,
      drawOpts: req.drawOpts,
    };
    // sanity: keep bbox math consistent with the backend's anchor semantics
    void bboxOfText(text, measure);

    let leader: StrokeDrawable | undefined;
    if (chosen && chosen.ringIndex >= 2) {
      // Displaced far: draw a thin leader from the anchor toward the label edge.
      const cx = finalBox.x + finalBox.w / 2;
      const cy = finalBox.y + finalBox.h / 2;
      const towardAnchor: Pt = [
        cx + (req.anchor[0] < cx ? -finalBox.w / 2 - 2 : finalBox.w / 2 + 2),
        cy,
      ];
      leader = {
        id: `${req.id}_leader`,
        kind: "stroke",
        pts: [req.anchor, towardAnchor],
        z: Z_STROKE,
        style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.8 }),
        drawOpts: defaultDrawOpts("instant"),
      };
    }

    placed.push({ text, leader });
  }

  return placed;
}
