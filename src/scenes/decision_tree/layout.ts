// Deterministic decision-tree layout using d3-hierarchy's tidy tree.
// Health-economics conventions: decision = square, chance = circle,
// terminal = triangle. The LLM never places nodes.

import { hierarchy, tree } from "d3-hierarchy";
import { CANVAS } from "../../layout/canvas";
import {
  COLORS,
  Z_STROKE,
  SKETCH_MS,
  defaultDrawOpts,
  defaultStyle,
  type Drawable,
  type Pt,
  type StrokeDrawable,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface TreeNode {
  id?: string;
  type: "decision" | "chance" | "terminal";
  label: string;
  /** Outcome value at a terminal (e.g. QALYs). May also sit on the incoming branch. */
  payoff?: number;
  cost?: number;
  children?: TreeBranch[];
}

export interface TreeBranch {
  label?: string;
  probability?: number;
  cost?: number;
  payoff?: number;
  node: TreeNode;
}

export interface DecisionTreeParams {
  root: TreeNode;
}

interface Wrapped {
  cleanId: string;
  node: TreeNode;
  branch?: TreeBranch;
  children: Wrapped[];
}

const MARGIN = { left: 95, right: 180, top: 65, bottom: 65 };

function wrap(node: TreeNode, path: number[], branch?: TreeBranch): Wrapped {
  return {
    cleanId: node.id ?? path.join("_"),
    node,
    branch,
    children: (node.children ?? []).map((b, i) => wrap(b.node, [...path, i], b)),
  };
}

function nodeRadius(type: TreeNode["type"]): number {
  return type === "decision" ? 34 : type === "chance" ? 30 : 32;
}

export function layoutDecisionTree(params: DecisionTreeParams): SceneLayout & { positions: Record<string, Pt> } {
  const rootWrapped = wrap(params.root, [0]);
  const h = hierarchy(rootWrapped, (d) => d.children);
  const plotW = CANVAS.w - MARGIN.left - MARGIN.right;
  const plotH = CANVAS.h - MARGIN.top - MARGIN.bottom;
  tree<Wrapped>().size([plotH, plotW])(h);

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const positions: Record<string, Pt> = {};
  const order: string[] = [];

  type LaidOut = typeof h & { x: number; y: number };
  const pos = (n: typeof h): Pt => {
    const l = n as LaidOut;
    // d3: x = breadth, y = depth. Horizontal tree: depth → logical x, breadth top-down → logical y.
    return [MARGIN.left + l.y, CANVAS.h - MARGIN.top - l.x];
  };

  // Nodes first (breadth-first, so drawing order reads root → leaves).
  for (const n of h.descendants()) {
    const { cleanId, node } = n.data;
    const c = pos(n);
    positions[cleanId] = c;
    const id = `node_${cleanId}`;
    anchors[id] = c;
    drawables.push(nodeDrawable(id, node.type, c));
    order.push(id);

    if (node.type === "terminal") {
      labels.push(labelReq(`label_${cleanId}`, c, "above-right", node.label, 24));
      order.push(`label_${cleanId}`);
      const b = n.data.branch;
      const payoff = node.payoff ?? b?.payoff;
      const cost = node.cost ?? b?.cost;
      if (payoff !== undefined || cost !== undefined) {
        const parts: string[] = [];
        if (payoff !== undefined) parts.push(String(payoff));
        if (cost !== undefined) parts.push(`cost ${cost}`);
        labels.push(labelReq(`payoff_${cleanId}`, [c[0] + 42, c[1]], "right", parts.join(", "), 24, COLORS.supply));
        order.push(`payoff_${cleanId}`);
      }
    } else {
      labels.push(labelReq(`label_${cleanId}`, [c[0], c[1] + nodeRadius(node.type)], "above", node.label, 24));
      order.push(`label_${cleanId}`);
    }
  }

  // Edges + branch labels.
  for (const n of h.descendants()) {
    const parent = n.parent;
    if (!parent) continue;
    const a = pos(parent);
    const b = pos(n);
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / dist;
    const uy = (b[1] - a[1]) / dist;
    const rA = nodeRadius(parent.data.node.type) + 6;
    const rB = nodeRadius(n.data.node.type) + 6;
    const from: Pt = [a[0] + ux * rA, a[1] + uy * rA];
    const to: Pt = [b[0] - ux * rB, b[1] - uy * rB];
    const id = `edge_${parent.data.cleanId}_${n.data.cleanId}`;
    drawables.push({
      id,
      kind: "stroke",
      pts: [from, to],
      z: Z_STROKE,
      style: defaultStyle({ strokeWidth: 2.5 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.connector),
    });
    const mid: Pt = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    anchors[id] = mid;
    order.push(id);

    const branch = n.data.branch;
    const parts: string[] = [];
    if (branch?.label) parts.push(branch.label);
    if (branch?.probability !== undefined) parts.push(`p=${branch.probability}`);
    if (parts.length > 0) {
      const text = branch?.probability !== undefined && branch.label ? `${branch.label} (p=${branch.probability})` : parts.join(" ");
      const labelId = `branchlabel_${parent.data.cleanId}_${n.data.cleanId}`;
      labels.push(labelReq(labelId, mid, "above", text, 22, COLORS.guide));
      order.push(labelId);
    }
  }

  return { drawables, labels, anchors, positions, order };
}

function nodeDrawable(id: string, type: TreeNode["type"], c: Pt): StrokeDrawable {
  const style = defaultStyle({ strokeWidth: 3, color: type === "decision" ? COLORS.demand : type === "chance" ? COLORS.supply : COLORS.ink });
  const drawOpts = defaultDrawOpts("sketch", SKETCH_MS.node);
  if (type === "decision") {
    const s = 27;
    return {
      id,
      kind: "stroke",
      pts: [
        [c[0] - s, c[1] - s],
        [c[0] + s, c[1] - s],
        [c[0] + s, c[1] + s],
        [c[0] - s, c[1] + s],
      ],
      closed: true,
      shapeHint: { type: "rect", x: c[0] - s, y: c[1] - s, w: 2 * s, h: 2 * s },
      z: Z_STROKE,
      style,
      drawOpts,
    };
  }
  if (type === "chance") {
    return { id, kind: "stroke", pts: [c], shapeHint: { type: "circle", c, r: 28 }, z: Z_STROKE, style, drawOpts };
  }
  const s = 26;
  return {
    id,
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
  };
}

function labelReq(id: string, anchor: Pt, side: LabelRequest["side"], text: string, fontSize: number, color: string = COLORS.ink): LabelRequest {
  return {
    id,
    anchor,
    side,
    text,
    fontSize,
    style: defaultStyle({ color }),
    drawOpts: defaultDrawOpts("instant"),
  };
}
