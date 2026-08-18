// The single spec format the LLM ever sees. See BRIEF.md and src/spec/schema.ts.
// All coordinates are logical (1000×750, y-up, origin bottom-left) or domain
// coordinates when a `domain` is declared — never screen pixels.

export type ElementType =
  | "axes"
  | "curve"
  | "point"
  | "arrow"
  | "label"
  | "region"
  | "node"
  | "edge"
  | "path"
  | "text"
  | "shape";

export type Side =
  | "above"
  | "below"
  | "left"
  | "right"
  | "above-left"
  | "above-right"
  | "below-left"
  | "below-right";

export interface SpecStyle {
  color?: string;
  fill?: string;
  stroke_width?: number;
  dash?: boolean;
  roughness?: number;
  opacity?: number;
}

export interface SpecDraw {
  mode?: "sketch" | "instant";
  /** seconds */
  duration?: number;
}

/** Endpoint of an arrow/edge: either a reference to an element id, or coordinates. */
export interface EndRef {
  ref?: string;
  x?: number;
  y?: number;
}

export interface SpecElement {
  id: string;
  type: ElementType;
  // axes
  x_label?: string;
  y_label?: string;
  // curve (qualitative or explicit expression over the x domain)
  direction?: "increasing" | "decreasing" | "flat" | "vertical";
  curvature?: "linear" | "convex" | "concave";
  steepness?: "gentle" | "medium" | "steep";
  expr?: string;
  x_from?: number;
  x_to?: number;
  // point
  at?: { x?: number; y?: number; intersection_of?: string[] };
  guides?: boolean;
  // arrow / edge
  from?: EndRef;
  to?: EndRef;
  curved?: boolean;
  // label
  text?: string;
  attach_to?: string;
  side?: Side;
  // region
  between?: string[];
  // node / tier-3 shape
  shape?: "decision" | "chance" | "terminal" | "rect" | "circle" | "triangle" | "person";
  // tier-3 raw coordinates (logical units)
  points?: [number, number][];
  closed?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  font_size?: number;
  // cross-cutting
  style?: SpecStyle;
  draw?: SpecDraw;
}

export interface Command {
  speak?: string;
  draw?: string[] | string;
  parallel?: boolean;
  /** seconds */
  pause?: number;
}

export interface Spec {
  title?: string;
  canvas?: { width: number; height: number };
  template?: string;
  params?: Record<string, unknown>;
  domain?: { x?: [number, number]; y?: [number, number] };
  elements?: SpecElement[];
  commands?: Command[];
}
