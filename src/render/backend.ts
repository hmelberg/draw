// Backend contract: a backend mounts the backend-independent layout IR into a
// container and returns per-element handles the Player can animate. Backends
// that can't animate return no handles — the Player then just sequences
// captions/speech over a statically rendered figure. The optional effects
// primitives power the gesture verbs (highlight/point/camera); backends
// without them simply skip those steps.

import type { BBox } from "../layout/geometry";
import type { LayoutResult } from "../layout/layout";
import type { Pt } from "../layout/model";
import type { HighlightEffect, Spec } from "../spec/types";

export interface RenderedElement {
  id: string;
  /** Intrinsic animation duration in ms (0 = instant). */
  durationMs: number;
  /** 0 = hidden … 1 = fully drawn. Monotonic per animation run. */
  setProgress(t: number): void;
  finish(): void;
  hide(): void;
  /**
   * Persistent translation in logical units (y-up), independent of draw
   * progress. Backends without it show moves only as the planner's warnings
   * suggest — not at all.
   */
  setOffset?(dx: number, dy: number): void;
}

/**
 * Stateless per-frame primitives; the Player owns all timing (so pause and the
 * speed multiplier apply to gestures exactly like they do to drawing).
 */
export interface BackendEffects {
  /**
   * Emphasis at progress t ∈ [0,1] on already-drawn elements. box is the
   * logical-units union box of the targets (for the circle effect).
   * t = 1 must leave the elements back in their normal appearance.
   */
  setHighlight(ids: string[], effect: HighlightEffect, t: number, box: BBox | null, color?: string): void;
  /** Remove any leftover emphasis for these ids (abort/scrub safety). */
  endHighlight(ids: string[]): void;
  /** Show the laser dot at a logical y-up point; null hides it. */
  setPointer(p: Pt | null): void;
  /** Jump the camera to a logical y-up viewBox; null = full canvas. */
  setCamera(box: BBox | null): void;
}

export interface MountResult {
  elements: Map<string, RenderedElement>;
  effects?: BackendEffects;
  destroy(): void;
}

export interface BackendModule {
  name: string;
  label: string;
  description: string;
  supportsAnimation: boolean;
  /** Whether this backend can render the given spec at all (mermaid is tree-only). */
  appliesTo(spec: Spec): boolean;
  mount(layout: LayoutResult, spec: Spec, container: HTMLElement): Promise<MountResult>;
}
