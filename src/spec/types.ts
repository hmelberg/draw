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

export type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";
export type HighlightEffect = "pulse" | "circle" | "glow";
export type PointGesture = "tap" | "circle" | "underline";

export interface HighlightArgs {
  target: string[] | string;
  effect?: HighlightEffect;
  /** seconds */
  duration?: number;
  color?: string;
}

export interface PointArgs {
  /** Element id (ref) or coordinates (domain units when a domain is declared). */
  at: EndRef;
  gesture?: PointGesture;
  /** seconds */
  duration?: number;
}

export interface MoveArgs {
  target: string[] | string;
  /** [dx, dy] delta — domain units when a domain is declared, else logical. */
  by?: [number, number];
  /** Waypoint offsets from the element's starting position; the last is the final offset. */
  path?: [number, number][];
  /** seconds */
  duration?: number;
  easing?: Easing;
}

export interface CameraArgs {
  /** Element id (ref) or coordinates to center on. */
  center?: EndRef;
  /** Magnification: 1 = whole canvas, 2 = 2×, … */
  zoom?: number;
  /** Return to the full canvas. */
  reset?: boolean;
  /** seconds */
  duration?: number;
}

export interface ClearArgs {
  /** Ids to leave visible (e.g. the axes). */
  keep?: string[] | string;
}

export interface Command {
  speak?: string;
  /** With speak: false = start speaking and continue to the next command immediately. */
  blocking?: boolean;
  draw?: string[] | string;
  /** With draw/erase: animate the listed elements simultaneously. */
  parallel?: boolean;
  /** seconds */
  pause?: number;
  /** Make elements visible instantly (inverse of hide). */
  show?: string[] | string;
  /** Make elements invisible instantly (they can be shown again). */
  hide?: string[] | string;
  /** Remove elements with a reverse hand-drawn animation, then keep them hidden. */
  erase?: string[] | string;
  /** Hide everything currently visible (except clear.keep). */
  clear?: ClearArgs;
  /** Temporary emphasis on visible elements. */
  highlight?: HighlightArgs;
  /** Laser pointer: travel to a target and gesture at it. */
  point?: PointArgs;
  /** Translate elements by a delta or along a path of offsets. */
  move?: MoveArgs;
  /** Zoom/pan the view. */
  camera?: CameraArgs;
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
