// Deterministic visual lint (Loop 1.2). Runs on the backend-independent layout
// IR, so every backend gets the same report and the results feed the LLM
// repair round as structured text.

import { CANVAS } from "../layout/canvas";
import { bboxOfPts, bboxOfText, boxesOverlap, expandBox, polylineIntersectsBox } from "../layout/geometry";
import { leafDrawables, type Drawable, type StrokeDrawable, type TextDrawable } from "../layout/model";
import type { MeasureFn } from "../layout/measure";

export const FONT_FLOOR = 14;
const CANVAS_TOLERANCE = 2;

export interface LintIssue {
  rule: "overlap-label-label" | "overlap-label-stroke" | "out-of-canvas" | "font-too-small";
  ids: string[];
  message: string;
  severity: "warn" | "error";
}

export function lintLayout(drawables: Drawable[], measure: MeasureFn): LintIssue[] {
  const issues: LintIssue[] = [];
  const leaves = leafDrawables(drawables);
  const texts = leaves.filter((d): d is TextDrawable => d.kind === "text");
  const strokes = leaves.filter((d): d is StrokeDrawable => d.kind === "stroke");

  for (const t of texts) {
    if (t.fontSize < FONT_FLOOR) {
      issues.push({
        rule: "font-too-small",
        ids: [t.id],
        message: `text "${t.id}" has font size ${t.fontSize} (< ${FONT_FLOOR} logical units — unreadable)`,
        severity: "warn",
      });
    }
  }

  // out-of-canvas
  for (const d of leaves) {
    let box;
    if (d.kind === "text") box = bboxOfText(d, measure);
    else if (d.pts.length > 0) box = d.kind === "stroke" && d.shapeHint?.type === "circle"
      ? { x: d.shapeHint.c[0] - d.shapeHint.r, y: d.shapeHint.c[1] - d.shapeHint.r, w: 2 * d.shapeHint.r, h: 2 * d.shapeHint.r }
      : bboxOfPts(d.pts);
    else continue;
    if (
      box.x < -CANVAS_TOLERANCE ||
      box.y < -CANVAS_TOLERANCE ||
      box.x + box.w > CANVAS.w + CANVAS_TOLERANCE ||
      box.y + box.h > CANVAS.h + CANVAS_TOLERANCE
    ) {
      issues.push({
        rule: "out-of-canvas",
        ids: [d.id],
        message: `element "${d.id}" extends outside the ${CANVAS.w}×${CANVAS.h} logical canvas`,
        severity: "error",
      });
    }
  }

  // label–label overlap
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = bboxOfText(texts[i], measure);
      const b = bboxOfText(texts[j], measure);
      if (boxesOverlap(a, b, 2)) {
        issues.push({
          rule: "overlap-label-label",
          ids: [texts[i].id, texts[j].id],
          message: `labels "${texts[i].id}" ("${texts[i].text}") and "${texts[j].id}" ("${texts[j].text}") overlap — choose different preferred sides`,
          severity: "warn",
        });
      }
    }
  }

  // label–stroke overlap (leader lines may touch their own label)
  for (const t of texts) {
    const box = expandBox(bboxOfText(t, measure), 1);
    for (const s of strokes) {
      if (s.id === `${t.id}_leader`) continue;
      if (s.pts.length >= 2 && polylineIntersectsBox(s.pts, box)) {
        issues.push({
          rule: "overlap-label-stroke",
          ids: [t.id, s.id],
          message: `label "${t.id}" ("${t.text}") sits on stroke "${s.id}" — move it to a different side`,
          severity: "warn",
        });
      }
    }
  }

  return issues;
}

/** Structured-text form for the LLM repair round. */
export function lintReportText(issues: LintIssue[]): string {
  return issues.map((i) => `[${i.severity}] ${i.rule}: ${i.message}`).join("\n");
}
