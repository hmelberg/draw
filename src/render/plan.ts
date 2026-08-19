// Pure command planning: normalizes the spec's command sequence against the
// element ids that layout actually produced, and precomputes the scene state
// (visible ids, per-element offsets, camera) at every step boundary so that
// step back / scrubbing is exact by construction. Backend-independent, fully tested.

import { CANVAS } from "../layout/canvas";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import type { Command, Easing, HighlightEffect, PointGesture } from "../spec/types";

export type PlanStep =
  | { kind: "speak"; text: string; blocking: boolean }
  | { kind: "draw"; ids: string[]; parallel: boolean; implicit?: boolean }
  | { kind: "pause"; seconds: number }
  | { kind: "show"; ids: string[] }
  | { kind: "hide"; ids: string[] }
  | { kind: "erase"; ids: string[]; parallel: boolean }
  | { kind: "clear"; ids: string[] }
  | { kind: "highlight"; ids: string[]; boxes: Record<string, BBox>; effect: HighlightEffect; seconds: number; color?: string }
  | { kind: "point"; x: number; y: number; box?: BBox; refId?: string; gesture: PointGesture; seconds: number }
  | { kind: "move"; ids: string[]; path: Pt[]; seconds: number; easing: Easing }
  | { kind: "camera"; box: BBox | null; seconds: number };

/** Scene state at a step boundary. A pure function of the step index. */
export interface SceneState {
  /** Ids visible after this step, in draw order. */
  visible: string[];
  /** Cumulative translation per moved id, logical units (y-up). */
  offsets: Record<string, Pt>;
  /** Camera viewBox in logical y-up coordinates; null = full canvas. */
  camera: BBox | null;
}

export const INITIAL_STATE: SceneState = { visible: [], offsets: {}, camera: null };

export interface Plan {
  steps: PlanStep[];
  /** states[i] = scene state after steps[0..i] have completed. */
  states: SceneState[];
  warnings: string[];
}

export interface PlanOptions {
  /** Layout-time bbox per element id (logical units), for point/camera/highlight targeting. */
  bboxOf?: (id: string) => BBox | null;
  /** Domain → logical point mapping (identity when no domain is declared). */
  toLogical?: (p: Pt) => Pt;
  /** Domain-delta → logical-delta mapping for move.by / move.path. */
  deltaToLogical?: (d: Pt) => Pt;
}

const CAMERA_MAX_ZOOM = 8;

export function planCommands(commands: Command[] | undefined, allIds: string[], opts: PlanOptions = {}): Plan {
  const bboxOf = opts.bboxOf ?? (() => null);
  const toLogical = opts.toLogical ?? ((p: Pt) => p);
  const deltaToLogical = opts.deltaToLogical ?? ((d: Pt) => d);

  const known = new Set(allIds);
  const steps: PlanStep[] = [];
  const states: SceneState[] = [];
  const warnings: string[] = [];
  /** Ids whose visibility the spec manages explicitly — excluded from the implicit final draw. */
  const mentioned = new Set<string>();

  let visible: string[] = [];
  const visibleSet = new Set<string>();
  const offsets: Record<string, Pt> = {};
  let camera: BBox | null = null;

  const pushStep = (step: PlanStep) => {
    steps.push(step);
    states.push({ visible: [...visible], offsets: { ...offsets }, camera });
  };
  const makeVisible = (ids: string[]) => {
    for (const id of ids) {
      if (!visibleSet.has(id)) {
        visibleSet.add(id);
        visible.push(id);
      }
    }
  };
  const makeHidden = (ids: string[]) => {
    for (const id of ids) visibleSet.delete(id);
    visible = visible.filter((id) => visibleSet.has(id));
  };
  const resolveIds = (raw: string[] | string | undefined, verb: string): string[] => {
    const requested = typeof raw === "string" ? [raw] : raw ?? [];
    return requested.filter((id) => {
      if (known.has(id)) return true;
      warnings.push(`${verb} command references unknown id "${id}" (dropped)`);
      return false;
    });
  };
  /** Element's current visual bbox: layout bbox shifted by its accumulated offset. */
  const currentBox = (id: string): BBox | null => {
    const box = bboxOf(id);
    if (!box) return null;
    const [dx, dy] = offsets[id] ?? [0, 0];
    return { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  };

  for (const cmd of commands ?? []) {
    if (cmd.speak !== undefined) {
      pushStep({ kind: "speak", text: cmd.speak, blocking: cmd.blocking !== false });
    } else if (cmd.draw !== undefined) {
      const ids = resolveIds(cmd.draw, "draw");
      ids.forEach((id) => mentioned.add(id));
      makeVisible(ids);
      pushStep({ kind: "draw", ids, parallel: cmd.parallel === true });
    } else if (cmd.pause !== undefined) {
      pushStep({ kind: "pause", seconds: cmd.pause });
    } else if (cmd.show !== undefined) {
      const ids = resolveIds(cmd.show, "show");
      ids.forEach((id) => mentioned.add(id));
      makeVisible(ids);
      pushStep({ kind: "show", ids });
    } else if (cmd.hide !== undefined) {
      const ids = resolveIds(cmd.hide, "hide");
      ids.forEach((id) => mentioned.add(id));
      makeHidden(ids);
      pushStep({ kind: "hide", ids });
    } else if (cmd.erase !== undefined) {
      const ids = resolveIds(cmd.erase, "erase");
      ids.forEach((id) => mentioned.add(id));
      // Only visible elements can animate an un-sketch; the rest just stay hidden.
      const animatable = ids.filter((id) => visibleSet.has(id));
      makeHidden(ids);
      if (animatable.length > 0) pushStep({ kind: "erase", ids: animatable, parallel: cmd.parallel === true });
    } else if (cmd.clear !== undefined) {
      const keep = new Set(resolveIds(cmd.clear.keep, "clear.keep"));
      const ids = visible.filter((id) => !keep.has(id));
      makeHidden(ids);
      pushStep({ kind: "clear", ids });
    } else if (cmd.highlight !== undefined) {
      const ids = resolveIds(cmd.highlight.target, "highlight").filter((id) => {
        if (visibleSet.has(id)) return true;
        warnings.push(`highlight target "${id}" is not visible at that point (skipped)`);
        return false;
      });
      if (ids.length === 0) continue;
      const boxes: Record<string, BBox> = {};
      for (const id of ids) {
        const box = bboxOf(id); // layout box; the player adds the live offset
        if (box) boxes[id] = box;
      }
      pushStep({
        kind: "highlight",
        ids,
        boxes,
        effect: cmd.highlight.effect ?? "pulse",
        seconds: cmd.highlight.duration ?? 1.5,
        color: cmd.highlight.color,
      });
    } else if (cmd.point !== undefined) {
      const at = cmd.point.at;
      let x: number, y: number;
      let box: BBox | undefined;
      let refId: string | undefined;
      if (at?.ref !== undefined) {
        if (!known.has(at.ref)) {
          warnings.push(`point command references unknown id "${at.ref}" (skipped)`);
          continue;
        }
        refId = at.ref;
        if (!visibleSet.has(at.ref)) warnings.push(`point target "${at.ref}" is not visible at that point`);
        const b = currentBox(at.ref);
        if (b) {
          box = b;
          x = b.x + b.w / 2;
          y = b.y + b.h / 2;
        } else {
          x = CANVAS.w / 2;
          y = CANVAS.h / 2;
        }
      } else if (at?.x !== undefined && at?.y !== undefined) {
        [x, y] = toLogical([at.x, at.y]);
      } else {
        warnings.push("point command without a resolvable target skipped");
        continue;
      }
      pushStep({ kind: "point", x, y, box, refId, gesture: cmd.point.gesture ?? "tap", seconds: cmd.point.duration ?? 2 });
    } else if (cmd.move !== undefined) {
      const ids = resolveIds(cmd.move.target, "move");
      for (const id of ids) {
        if (!visibleSet.has(id)) warnings.push(`move target "${id}" is not visible at that point (still moved)`);
      }
      const rawPath = cmd.move.path && cmd.move.path.length > 0 ? cmd.move.path : cmd.move.by ? [cmd.move.by] : null;
      if (ids.length === 0 || !rawPath) {
        if (!rawPath) warnings.push("move command without by/path skipped");
        continue;
      }
      const path = rawPath.map((d) => deltaToLogical(d as Pt));
      const [fx, fy] = path[path.length - 1];
      for (const id of ids) {
        const [ox, oy] = offsets[id] ?? [0, 0];
        offsets[id] = [ox + fx, oy + fy];
      }
      pushStep({ kind: "move", ids, path, seconds: cmd.move.duration ?? 1, easing: cmd.move.easing ?? "ease-in-out" });
    } else if (cmd.camera !== undefined) {
      let box: BBox | null = null;
      if (!cmd.camera.reset) {
        const zoom = Math.min(CAMERA_MAX_ZOOM, Math.max(1, cmd.camera.zoom ?? 2));
        if (zoom <= 1) {
          box = null;
        } else {
          let cx = camera ? camera.x + camera.w / 2 : CANVAS.w / 2;
          let cy = camera ? camera.y + camera.h / 2 : CANVAS.h / 2;
          const center = cmd.camera.center;
          if (center?.ref !== undefined) {
            if (!known.has(center.ref)) {
              warnings.push(`camera command references unknown id "${center.ref}" (centering on canvas)`);
            } else {
              const b = currentBox(center.ref);
              if (b) {
                cx = b.x + b.w / 2;
                cy = b.y + b.h / 2;
              }
            }
          } else if (center?.x !== undefined && center?.y !== undefined) {
            [cx, cy] = toLogical([center.x, center.y]);
          }
          const w = CANVAS.w / zoom;
          const h = CANVAS.h / zoom;
          box = {
            x: Math.min(Math.max(cx - w / 2, 0), CANVAS.w - w),
            y: Math.min(Math.max(cy - h / 2, 0), CANVAS.h - h),
            w,
            h,
          };
        }
      }
      camera = box;
      pushStep({ kind: "camera", box, seconds: cmd.camera.duration ?? 1.2 });
    } else {
      warnings.push("command with no recognized verb skipped");
    }
  }

  const remaining = allIds.filter((id) => !mentioned.has(id));
  if (remaining.length > 0) {
    makeVisible(remaining);
    pushStep({ kind: "draw", ids: remaining, parallel: false, implicit: true });
  }

  return { steps, states, warnings };
}
