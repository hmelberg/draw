// Deterministic layout for the qaly_profiles scene: health-related quality of
// life (utility, 0–1) over age/time, one curve per scenario. Utility profiles
// are described semantically as waypoints ({t, u, step?}) with an optional
// death age; the layout interpolates non-linearly (eased), renders vertical
// drops for discontinuities, and shades gain/loss areas between two profiles
// (area under a curve = QALYs, so shading carries the meaning).

import { linearScale, plotArea } from "../../layout/canvas";
import { centroid } from "../../layout/geometry";
import { makeAxes } from "../../layout/axes";
import {
  COLORS,
  SKETCH_MS,
  Z_AREA,
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  type AreaDrawable,
  type Drawable,
  type GroupDrawable,
  type Pt,
  type StrokeDrawable,
  type TextDrawable,
} from "../../layout/model";
import type { LabelRequest } from "../../layout/labels";
import type { SceneLayout } from "../types";

export interface QalyWaypoint {
  /** age / time */
  t: number;
  /** utility 0–1 */
  u: number;
  /** true = the value jumps to u at time t (disease onset, treatment start) */
  step?: boolean;
}

export interface QalyProfile {
  id?: string;
  label?: string;
  color?: string;
  /** shade the area under this curve (its QALYs) */
  fill?: boolean;
  waypoints?: QalyWaypoint[];
  /** utility drops to 0 here (end of the curve) */
  death_at?: number;
}

export interface QalyParams {
  x_label?: string;
  y_label?: string;
  x_max?: number;
  profiles?: QalyProfile[];
  /** shade gain (a above b) and loss (a below b) areas; null disables. Defaults to the two profiles. */
  shade_between?: { a?: string; b?: string; gain_label?: string; loss_label?: string } | null;
}

const PALETTE = [COLORS.supply, COLORS.demand, COLORS.accent];

// The classic "treatment bounce" comparison, used when the LLM gives no profiles.
const DEFAULT_PROFILES: QalyProfile[] = [
  {
    id: "without",
    label: "Without treatment",
    waypoints: [
      { t: 0, u: 0.92 },
      { t: 40, u: 0.84 },
      { t: 40, u: 0.38, step: true },
      { t: 62, u: 0.24 },
    ],
    death_at: 68,
  },
  {
    id: "with",
    label: "With treatment",
    waypoints: [
      { t: 0, u: 0.92 },
      { t: 40, u: 0.84 },
      { t: 40, u: 0.26, step: true },
      { t: 44, u: 0.74 },
      { t: 72, u: 0.6 },
    ],
    death_at: 80,
  },
];

interface Segment {
  t0: number;
  u0: number;
  t1: number;
  u1: number;
  kind: "smooth" | "vertical";
}

const clampU = (u: number) => Math.min(1, Math.max(0, u));

/** Waypoints → piecewise segments. `step` holds the level, then jumps at t. */
function buildSegments(profile: QalyProfile): Segment[] {
  const wps = [...(profile.waypoints ?? [])]
    .map((w) => ({ ...w, u: clampU(w.u) }))
    .sort((a, b) => a.t - b.t || Number(a.step ?? false) - Number(b.step ?? false));
  const segments: Segment[] = [];
  for (let i = 1; i < wps.length; i++) {
    const w0 = wps[i - 1];
    const w1 = wps[i];
    if (w1.step) {
      if (w1.t > w0.t + 1e-9) segments.push({ t0: w0.t, u0: w0.u, t1: w1.t, u1: w0.u, kind: "smooth" });
      segments.push({ t0: w1.t, u0: w0.u, t1: w1.t, u1: w1.u, kind: "vertical" });
    } else if (w1.t > w0.t + 1e-9) {
      segments.push({ t0: w0.t, u0: w0.u, t1: w1.t, u1: w1.u, kind: "smooth" });
    }
  }
  const last = wps[wps.length - 1];
  if (last && profile.death_at !== undefined && profile.death_at > last.t) {
    segments.push({ t0: last.t, u0: last.u, t1: profile.death_at, u1: last.u, kind: "smooth" });
    segments.push({ t0: profile.death_at, u0: last.u, t1: profile.death_at, u1: 0, kind: "vertical" });
  } else if (last && profile.death_at !== undefined) {
    segments.push({ t0: last.t, u0: last.u, t1: last.t, u1: 0, kind: "vertical" });
  }
  return segments;
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Utility as a function of time (0 after death, held flat outside waypoints). */
function profileFn(segments: Segment[], deathAt: number | undefined): (t: number) => number {
  return (t: number) => {
    if (segments.length === 0) return 0;
    if (deathAt !== undefined && t >= deathAt) return 0;
    if (t <= segments[0].t0) return segments[0].u0;
    for (const s of segments) {
      if (s.kind === "vertical") continue;
      if (t >= s.t0 && t <= s.t1) {
        const tau = (t - s.t0) / (s.t1 - s.t0 || 1);
        return s.u0 + (s.u1 - s.u0) * smoothstep(tau);
      }
    }
    const lastSmooth = [...segments].reverse().find((s) => s.kind === "smooth");
    return lastSmooth ? lastSmooth.u1 : segments[segments.length - 1].u1;
  };
}

function samplePts(segments: Segment[], sx: (v: number) => number, sy: (v: number) => number): Pt[] {
  const pts: Pt[] = [];
  for (const s of segments) {
    if (s.kind === "vertical") {
      pts.push([sx(s.t0), sy(s.u0)], [sx(s.t1), sy(s.u1)]);
    } else {
      const n = Math.max(8, Math.round((s.t1 - s.t0) * 0.8));
      for (let i = 0; i <= n; i++) {
        const tau = i / n;
        const t = s.t0 + (s.t1 - s.t0) * tau;
        pts.push([sx(t), sy(s.u0 + (s.u1 - s.u0) * smoothstep(tau))]);
      }
    }
  }
  return pts;
}

export function layoutQalyProfiles(params: QalyParams): SceneLayout {
  const plot = plotArea();
  const profiles = (params.profiles?.length ? params.profiles : DEFAULT_PROFILES).map((p, i) => ({
    ...p,
    id: (p.id ?? `profile_${i + 1}`).replace(/[^a-zA-Z0-9_]/g, "_"),
    color: p.color ?? PALETTE[i % PALETTE.length],
  }));

  const tMax =
    params.x_max ??
    Math.max(...profiles.flatMap((p) => [(p.death_at ?? 0) + 6, ...(p.waypoints ?? []).map((w) => w.t + 6)]), 50);
  const sx = linearScale([0, tMax], [plot.x0, plot.x1]);
  const sy = linearScale([0, 1.06], [plot.y0, plot.y1]); // headroom above u=1

  const drawables: Drawable[] = [];
  const labels: LabelRequest[] = [];
  const anchors: Record<string, Pt> = {};
  const order: string[] = [];
  const push = (d: Drawable) => {
    drawables.push(d);
    order.push(d.id);
  };
  const label = (id: string, anchor: Pt, side: LabelRequest["side"], text: string, color: string) => {
    labels.push({ id, anchor, side, text, fontSize: 26, style: defaultStyle({ color }), drawOpts: defaultDrawOpts("instant") });
    anchors[id] = anchor;
    order.push(id);
  };

  push(makeAxes("axes", plot, params.x_label ?? "Age (years)", params.y_label ?? "Quality of life"));

  // Dashed ceiling at u = 1 ("perfect health") with axis tick labels 0 and 1.
  const ceiling: StrokeDrawable = {
    id: "full_health_line",
    kind: "stroke",
    pts: [
      [plot.x0, sy(1)],
      [sx(tMax * 0.99), sy(1)],
    ],
    z: Z_STROKE,
    style: defaultStyle({ color: COLORS.guide, strokeWidth: 2, dash: true, roughness: 0.9 }),
    drawOpts: defaultDrawOpts("sketch", SKETCH_MS.guides),
  };
  push(ceiling);
  anchors["full_health_line"] = [plot.x0 + 60, sy(1)];
  const tick = (id: string, u: number, text: string): TextDrawable => ({
    id,
    kind: "text",
    pos: [plot.x0 - 26, sy(u)],
    text,
    fontSize: 24,
    anchor: "middle",
    z: Z_TEXT,
    style: defaultStyle({ color: COLORS.guide }),
    drawOpts: defaultDrawOpts("instant"),
  });
  push(tick("tick_one", 1, "1"));
  push(tick("tick_zero", 0, "0"));

  // Per-profile curves (and optional under-curve fills).
  const fns = new Map<string, (t: number) => number>();
  const ends = new Map<string, number>();
  for (const p of profiles) {
    const segments = buildSegments(p);
    fns.set(p.id, profileFn(segments, p.death_at));
    ends.set(p.id, p.death_at ?? (p.waypoints?.length ? Math.max(...p.waypoints.map((w) => w.t)) : tMax));
    const pts = samplePts(segments, sx, sy);
    if (pts.length < 2) continue;

    if (p.fill) {
      const areaPts: Pt[] = [...pts, [pts[pts.length - 1][0], sy(0)], [pts[0][0], sy(0)]];
      push({
        id: `fill_${p.id}`,
        kind: "area",
        pts: areaPts,
        z: Z_AREA,
        style: defaultStyle({ color: p.color, fill: p.color, opacity: 0.35, strokeWidth: 1 }),
        drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
      });
      anchors[`fill_${p.id}`] = centroid(areaPts);
    }

    push({
      id: `curve_${p.id}`,
      kind: "stroke",
      pts,
      z: Z_STROKE,
      style: defaultStyle({ color: p.color, strokeWidth: 4.5 }),
      drawOpts: defaultDrawOpts("sketch", SKETCH_MS.curve),
    });
    // Anchor the label at the last level stretch before the death drop.
    const anchorPt = pts[Math.max(0, pts.length - 3)];
    anchors[`curve_${p.id}`] = anchorPt;
    label(`label_${p.id}`, anchorPt, "above-right", p.label ?? p.id, p.color);
  }

  // Gain/loss shading between two profiles (default: the first two).
  const shade = params.shade_between === null ? null : params.shade_between ?? {};
  if (shade && profiles.length >= 2) {
    const aId = profiles.find((p) => p.id === shade.a)?.id ?? profiles[1].id;
    const bId = profiles.find((p) => p.id === shade.b)?.id ?? profiles[0].id;
    if (aId !== bId) {
      const fa = fns.get(aId)!;
      const fb = fns.get(bId)!;
      const tEnd = Math.min(tMax, Math.max(ends.get(aId)!, ends.get(bId)!));
      const N = 220;
      const eps = 0.008;
      const runs: { sign: 1 | -1; upper: Pt[]; lower: Pt[] }[] = [];
      let current: { sign: 1 | -1; upper: Pt[]; lower: Pt[] } | null = null;
      for (let i = 0; i <= N; i++) {
        const t = (tEnd * i) / N;
        const ua = fa(t);
        const ub = fb(t);
        const diff = ua - ub;
        const sign: 1 | -1 | 0 = diff > eps ? 1 : diff < -eps ? -1 : 0;
        if (sign === 0) {
          current = null;
          continue;
        }
        if (!current || current.sign !== sign) {
          current = { sign, upper: [], lower: [] };
          runs.push(current);
        }
        current.upper.push([sx(t), sy(Math.max(ua, ub))]);
        current.lower.push([sx(t), sy(Math.min(ua, ub))]);
      }
      const makeGroup = (id: string, sign: 1 | -1, color: string): GroupDrawable | null => {
        const children: AreaDrawable[] = runs
          .filter((r) => r.sign === sign && r.upper.length >= 2)
          .map((r, i) => ({
            id: `${id}_${i + 1}`,
            kind: "area" as const,
            pts: [...r.upper, ...[...r.lower].reverse()],
            z: Z_AREA,
            style: defaultStyle({ color, fill: color, opacity: 0.45, strokeWidth: 1 }),
            drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
          }));
        if (children.length === 0) return null;
        return {
          id,
          kind: "group",
          children,
          z: Z_AREA,
          style: defaultStyle({ color }),
          drawOpts: defaultDrawOpts("sketch", SKETCH_MS.region),
        };
      };
      const gains = makeGroup("gain_regions", 1, COLORS.region2);
      const losses = makeGroup("loss_regions", -1, COLORS.regionLoss);
      if (gains) {
        push(gains);
        const biggest = gains.children.reduce((a, b) => ((a as AreaDrawable).pts.length >= (b as AreaDrawable).pts.length ? a : b));
        anchors["gain_regions"] = centroid((biggest as AreaDrawable).pts);
        label("label_gain", anchors["gain_regions"], "above-right", shade.gain_label ?? "QALYs gained", COLORS.region2);
      }
      if (losses) {
        push(losses);
        const biggest = losses.children.reduce((a, b) => ((a as AreaDrawable).pts.length >= (b as AreaDrawable).pts.length ? a : b));
        anchors["loss_regions"] = centroid((biggest as AreaDrawable).pts);
        if (shade.loss_label !== "") {
          label("label_loss", anchors["loss_regions"], "below-left", shade.loss_label ?? "Initial loss", COLORS.regionLoss);
        }
      }
    }
  }

  return { drawables, labels, anchors, order };
}
