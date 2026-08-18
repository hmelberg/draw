// The JSON Schema for the drawing spec. It serves three roles at once:
// 1. output constraint for the LLM (structured outputs),
// 2. ajv validation before rendering (Loop 1.1),
// 3. prompt documentation (embedded verbatim in the compiler prompt).
// Keep it flat and free of oneOf/anyOf so structured-output decoding accepts it;
// per-type requirements are enforced by the semantic checks below and fed back
// to the LLM in the repair round.

import AjvModule, { type ValidateFunction } from "ajv";
import type { Command, Spec, SpecElement } from "./types";

// ajv ships CJS; depending on the bundler/runtime the class is the module or its .default.
const AjvCtor = ((AjvModule as unknown as { default?: unknown }).default ?? AjvModule) as typeof AjvModule;

export const SPEC_VERSION = "1";

const styleSchema = {
  type: "object",
  description: "Optional visual style overrides.",
  properties: {
    color: { type: "string", description: "Stroke/text color, CSS color string." },
    fill: { type: "string", description: "Fill color for regions/shapes." },
    stroke_width: { type: "number" },
    dash: { type: "boolean", description: "Dashed stroke (guide lines etc.)." },
    roughness: { type: "number", description: "Hand-drawn sketchiness 0 (clean) to 3 (very rough)." },
    opacity: { type: "number" },
  },
  additionalProperties: false,
};

const drawSchema = {
  type: "object",
  description: "How this element animates when drawn.",
  properties: {
    mode: { type: "string", enum: ["sketch", "instant"], description: "sketch = progressive handwriting-style drawing; instant = appears at once." },
    duration: { type: "number", description: "Animation duration in seconds (sketch mode)." },
  },
  additionalProperties: false,
};

const endRefSchema = {
  type: "object",
  description: "Arrow/edge endpoint: set ref to an element id, OR x+y coordinates (domain coordinates if a domain is declared, else logical).",
  properties: {
    ref: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
  },
  additionalProperties: false,
};

const elementSchema = {
  type: "object",
  description:
    "One diagram element. The `type` decides which other properties apply. " +
    "Tier 2 (preferred): axes, curve, point, arrow, label, region, node, edge — you describe relations, the renderer computes geometry. " +
    "Tier 3 (escape hatch only): path, text, shape with explicit logical coordinates (1000×750, y-up, origin bottom-left).",
  properties: {
    id: { type: "string", description: "Unique id, referenced by commands and other elements." },
    type: {
      type: "string",
      enum: ["axes", "curve", "point", "arrow", "label", "region", "node", "edge", "path", "text", "shape"],
    },
    // axes
    x_label: { type: "string", description: "axes: horizontal axis label." },
    y_label: { type: "string", description: "axes: vertical axis label." },
    // curve
    direction: { type: "string", enum: ["increasing", "decreasing", "flat", "vertical"], description: "curve: qualitative slope." },
    curvature: { type: "string", enum: ["linear", "convex", "concave"], description: "curve: qualitative curvature." },
    steepness: { type: "string", enum: ["gentle", "medium", "steep"], description: "curve: qualitative steepness." },
    expr: { type: "string", description: "curve: explicit function of x over the domain, e.g. \"100 - 0.5*x\". Use instead of direction/curvature when you know the function." },
    x_from: { type: "number", description: "curve/region: start of the x interval (domain units). Defaults to the whole domain." },
    x_to: { type: "number", description: "curve/region: end of the x interval (domain units)." },
    // point
    at: {
      type: "object",
      description: "point: location, either x+y in domain units, or intersection_of two curve ids.",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        intersection_of: { type: "array", items: { type: "string" }, description: "Two curve ids; the point is their intersection." },
      },
      additionalProperties: false,
    },
    guides: { type: "boolean", description: "point: draw dashed guide lines from the point to both axes." },
    // arrow / edge
    from: endRefSchema,
    to: endRefSchema,
    curved: { type: "boolean", description: "arrow/edge: bow the line slightly." },
    // label
    text: { type: "string", description: "label/text/node: the text content." },
    attach_to: { type: "string", description: "label: id of the element this label belongs to. The renderer places it (collision-avoiding)." },
    side: {
      type: "string",
      enum: ["above", "below", "left", "right", "above-left", "above-right", "below-left", "below-right"],
      description: "label: preferred side relative to the attached element. The collision solver may move it.",
    },
    // region
    between: { type: "array", items: { type: "string" }, description: "region: two curve ids; the region is shaded between them (use x_from/x_to to limit)." },
    // node / shape
    shape: {
      type: "string",
      enum: ["decision", "chance", "terminal", "rect", "circle", "triangle", "person"],
      description: "node/shape: decision=square, chance=circle, terminal=triangle (health-economics conventions); person = stick figure.",
    },
    // tier-3 raw
    points: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 }, description: "path: polyline points in logical coordinates (y-up)." },
    closed: { type: "boolean", description: "path: close the polyline." },
    x: { type: "number", description: "text/shape: logical x (y-up canvas)." },
    y: { type: "number", description: "text/shape: logical y (y-up canvas)." },
    width: { type: "number", description: "shape rect: width in logical units." },
    height: { type: "number", description: "shape rect: height in logical units." },
    radius: { type: "number", description: "shape circle: radius in logical units." },
    font_size: { type: "number", description: "text: font size in logical units (≥ 14; default 26)." },
    style: styleSchema,
    draw: drawSchema,
  },
  required: ["id", "type"],
  additionalProperties: false,
};

const commandSchema = {
  type: "object",
  description:
    "One playback command. Set EXACTLY ONE of speak / draw / pause. Commands run strictly in sequence; each completes before the next begins.",
  properties: {
    speak: { type: "string", description: "Narration sentence, spoken aloud and shown as a caption." },
    draw: {
      type: "array",
      items: { type: "string" },
      description: "Element ids to draw. Listed elements animate one after another unless parallel is true.",
    },
    parallel: { type: "boolean", description: "With draw: animate the listed elements simultaneously." },
    pause: { type: "number", description: "Pause for this many seconds." },
  },
  additionalProperties: false,
};

export const specSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "ConceptSketchSpec",
  type: "object",
  description:
    "A drawing spec. Coordinate world: logical canvas 1000×750, Cartesian, y-up, origin bottom-left. " +
    "Prefer a scene template (set template+params, see the scene catalog). Otherwise compose tier-2 elements. " +
    "Commands interleave narration (speak) with drawing (draw) for a gradually built, narrated figure.",
  properties: {
    title: { type: "string", description: "Short title of the figure." },
    template: { type: "string", description: "Scene template name from the catalog. Omit when composing elements directly." },
    params: { type: "object", description: "Scene template parameters, per the catalog's parameter schema.", additionalProperties: true },
    domain: {
      type: "object",
      description: "Domain coordinate ranges for quantitative diagrams, e.g. {\"x\": [0, 1000], \"y\": [0, 50]} for quantity/price. Curve exprs and point coordinates are in these units.",
      properties: {
        x: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
        y: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
      },
      additionalProperties: false,
    },
    elements: { type: "array", items: elementSchema, description: "Tier-2/3 elements (also allowed alongside a template, for annotations)." },
    commands: { type: "array", items: commandSchema, description: "The playback sequence: speak/draw/pause. Elements not mentioned in any draw command are drawn at the end automatically." },
  },
  required: ["commands"],
  additionalProperties: false,
} as const;

const ajv = new AjvCtor({ allErrors: true, strict: false });
let structural: ValidateFunction | null = null;

/**
 * The wire schema keeps `draw` as an array (structured-output-friendly), but the
 * brief's spec examples also allow a bare string. Normalize before validating.
 */
export function normalizeSpec(spec: unknown): unknown {
  if (typeof spec !== "object" || spec === null) return spec;
  const clone = JSON.parse(JSON.stringify(spec)) as { commands?: Command[] };
  for (const cmd of clone.commands ?? []) {
    if (typeof cmd?.draw === "string") cmd.draw = [cmd.draw];
  }
  return clone;
}

function structuralErrors(spec: unknown): string[] {
  structural ??= ajv.compile(specSchema as object);
  if (structural(spec)) return [];
  return (structural.errors ?? []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}${e.params ? " " + JSON.stringify(e.params) : ""}`,
  );
}

function semanticErrors(spec: Spec): string[] {
  const errors: string[] = [];

  if (!spec.template && !(spec.elements && spec.elements.length > 0)) {
    errors.push("spec has neither a template nor any elements — nothing to draw");
  }

  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    const kinds = (["speak", "draw", "pause"] as const).filter((k) => (cmd as Command)[k] !== undefined);
    if (kinds.length !== 1) {
      errors.push(`commands[${i}] must set exactly one of speak/draw/pause (got: ${kinds.join(", ") || "none"})`);
    }
  }

  const seen = new Set<string>();
  for (const el of spec.elements ?? []) {
    if (seen.has(el.id)) errors.push(`duplicate element id "${el.id}"`);
    seen.add(el.id);
    errors.push(...elementErrors(el));
  }

  return errors;
}

function elementErrors(el: SpecElement): string[] {
  const errs: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errs.push(`element "${el.id}" (${el.type}): ${msg}`);
  };
  switch (el.type) {
    case "curve":
      need(!!el.expr || !!el.direction, "needs either expr or a qualitative direction");
      break;
    case "label":
      need(!!el.text, "needs text");
      need(!!el.attach_to, "needs attach_to (id of the element it labels)");
      break;
    case "region":
      need(Array.isArray(el.between) && el.between.length === 2, "needs between: [curveId, curveId]");
      break;
    case "point":
      need(!!el.at, "needs at ({x,y} or {intersection_of})");
      break;
    case "arrow":
    case "edge":
      need(!!el.from && !!el.to, "needs from and to");
      break;
    case "path":
      need(Array.isArray(el.points) && el.points.length >= 2, "needs points (≥ 2)");
      break;
    case "text":
      need(!!el.text, "needs text");
      need(typeof el.x === "number" && typeof el.y === "number", "needs x and y (logical coordinates)");
      break;
    case "shape":
      need(!!el.shape, "needs shape");
      break;
    default:
      break;
  }
  return errs;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateSpec(spec: unknown): ValidationResult {
  const normalized = normalizeSpec(spec);
  const sErrors = structuralErrors(normalized);
  if (sErrors.length > 0) return { ok: false, errors: sErrors };
  const errors = semanticErrors(normalized as Spec);
  return { ok: errors.length === 0, errors };
}
