// Backend contract: a backend mounts the backend-independent layout IR into a
// container and returns per-element handles the Player can animate. Backends
// that can't animate return no handles — the Player then just sequences
// captions/speech over a statically rendered figure.

import type { LayoutResult } from "../layout/layout";
import type { Spec } from "../spec/types";

export interface RenderedElement {
  id: string;
  /** Intrinsic animation duration in ms (0 = instant). */
  durationMs: number;
  /** 0 = hidden … 1 = fully drawn. Monotonic per animation run. */
  setProgress(t: number): void;
  finish(): void;
  hide(): void;
}

export interface MountResult {
  elements: Map<string, RenderedElement>;
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
