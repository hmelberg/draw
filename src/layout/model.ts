// The backend-independent layout IR. Scenes and tier-2 layout produce Drawables
// in logical y-up coordinates; every rendering backend consumes them.

export type Pt = [number, number];

export interface ResolvedStyle {
  color: string;
  fill?: string;
  strokeWidth: number;
  dash?: boolean;
  roughness: number;
  opacity: number;
}

export interface DrawResolved {
  mode: "sketch" | "instant";
  /** milliseconds */
  duration: number;
}

export type ShapeHint =
  | { type: "circle"; c: Pt; r: number }
  | { type: "rect"; x: number; y: number; w: number; h: number };

interface BaseDrawable {
  id: string;
  z: number;
  style: ResolvedStyle;
  drawOpts: DrawResolved;
}

export interface StrokeDrawable extends BaseDrawable {
  kind: "stroke";
  pts: Pt[];
  closed?: boolean;
  arrowhead?: "end" | "start" | "both";
  /** Lets backends draw a true circle/rect instead of the sampled polyline. */
  shapeHint?: ShapeHint;
}

export interface AreaDrawable extends BaseDrawable {
  kind: "area";
  pts: Pt[];
}

export interface TextDrawable extends BaseDrawable {
  kind: "text";
  pos: Pt;
  text: string;
  fontSize: number;
  anchor: "start" | "middle" | "end";
}

export interface GroupDrawable extends BaseDrawable {
  kind: "group";
  children: Drawable[];
}

export type Drawable = StrokeDrawable | AreaDrawable | TextDrawable | GroupDrawable;

export const Z_AREA = 0;
export const Z_STROKE = 1;
export const Z_TEXT = 2;

// Palette (see also src/styles.css). Warm ink on paper; curves get semantic colors.
export const INK = "#3d3833";
export const COLORS = {
  ink: INK,
  demand: "#b5482e",
  supply: "#2f6b8f",
  shifted: "#d0865f",
  accent: "#8a5fa8",
  guide: "#8f887c",
  region1: "#f2c14e",
  region2: "#87a878",
  regionLoss: "#c96567",
} as const;

export function defaultStyle(overrides: Partial<ResolvedStyle> = {}): ResolvedStyle {
  return { color: INK, strokeWidth: 3, roughness: 1.4, opacity: 1, ...overrides };
}

export function defaultDrawOpts(mode: "sketch" | "instant" = "sketch", durationMs?: number): DrawResolved {
  return { mode, duration: mode === "instant" ? 0 : (durationMs ?? 1100) };
}

/** Pre-order flatten: groups are included, followed by their children. */
export function flattenDrawables(drawables: Drawable[]): Drawable[] {
  const out: Drawable[] = [];
  const walk = (d: Drawable) => {
    out.push(d);
    if (d.kind === "group") d.children.forEach(walk);
  };
  drawables.forEach(walk);
  return out;
}

/** Leaves only (what actually gets painted / linted). */
export function leafDrawables(drawables: Drawable[]): Exclude<Drawable, GroupDrawable>[] {
  return flattenDrawables(drawables).filter((d): d is Exclude<Drawable, GroupDrawable> => d.kind !== "group");
}
