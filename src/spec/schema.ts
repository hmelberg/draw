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

const idListSchema = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

const commandSchema = {
  type: "object",
  description:
    "One playback command. Set EXACTLY ONE verb: speak / draw / pause / show / hide / erase / clear / highlight / point / move / camera. " +
    "Commands run strictly in sequence; each completes before the next begins (except speak with blocking:false).",
  properties: {
    speak: { type: "string", description: "Narration sentence, spoken aloud and shown as a caption." },
    blocking: {
      type: "boolean",
      description: "With speak: false starts the narration and immediately continues to the next command — use it to talk while pointing, highlighting, or drawing.",
    },
    draw: idListSchema("Element ids to draw. Listed elements animate one after another unless parallel is true."),
    parallel: { type: "boolean", description: "With draw/erase: animate the listed elements simultaneously." },
    pause: { type: "number", description: "Pause for this many seconds." },
    show: idListSchema("Element ids to make visible instantly (inverse of hide; no animation)."),
    hide: idListSchema("Element ids to make invisible instantly. Hidden elements still exist and can be shown again."),
    erase: idListSchema("Element ids to remove with a reverse hand-drawn (un-sketch) animation, then keep hidden."),
    clear: {
      type: "object",
      description: "Hide everything currently visible. Use {} to clear all, or keep to leave some ids on screen.",
      properties: {
        keep: idListSchema("Ids to leave visible (e.g. the axes)."),
      },
      additionalProperties: false,
    },
    highlight: {
      type: "object",
      description: "Temporarily emphasize visible elements, then return to normal. Great right after a speak line that refers to them.",
      properties: {
        target: idListSchema("Element ids to emphasize."),
        effect: { type: "string", enum: ["pulse", "circle", "glow"], description: "pulse = throb (default); circle = hand-drawn ring around them; glow = colored halo." },
        duration: { type: "number", description: "Seconds (default 1.5)." },
        color: { type: "string", description: "Emphasis color, CSS color string." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    point: {
      type: "object",
      description: "A laser pointer travels to the target and gestures at it, then disappears. Combine with speak blocking:false to talk while pointing.",
      properties: {
        at: endRefSchema,
        gesture: { type: "string", enum: ["tap", "circle", "underline"], description: "tap = dip at the spot (default); circle = trace a ring around it; underline = sweep beneath it." },
        duration: { type: "number", description: "Seconds (default 2)." },
      },
      required: ["at"],
      additionalProperties: false,
    },
    move: {
      type: "object",
      description:
        "Translate elements by a delta or along a path of offsets. Moves ONLY the listed elements — attached labels, intersection points, or regions do NOT follow; move them explicitly or redraw derived elements.",
      properties: {
        target: idListSchema("Element ids to move together."),
        by: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[dx, dy] delta — domain units when a domain is declared, else logical units." },
        path: {
          type: "array",
          items: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 },
          description: "Waypoint offsets from the element's starting position (same units as by); the last waypoint is the final offset. Use instead of by for curved or multi-leg motion.",
        },
        duration: { type: "number", description: "Seconds (default 1)." },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"], description: "Velocity profile (default ease-in-out)." },
      },
      required: ["target"],
      additionalProperties: false,
    },
    camera: {
      type: "object",
      description: "Zoom/pan the view. Set reset:true to return to the full canvas.",
      properties: {
        center: endRefSchema,
        zoom: { type: "number", description: "Magnification: 1 = whole canvas, 2 = 2× (default 2 when centering)." },
        reset: { type: "boolean", description: "Return to the full canvas." },
        duration: { type: "number", description: "Seconds (default 1.2)." },
      },
      additionalProperties: false,
    },
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
    commands: {
      type: "array",
      items: commandSchema,
      description:
        "The playback sequence: narration (speak), drawing (draw/pause), and gesture verbs (highlight/point/move/show/hide/erase/clear/camera). " +
        "Elements not mentioned in any draw/show/hide/erase command are drawn at the end automatically.",
    },
  },
  required: ["commands"],
  additionalProperties: false,
} as const;

const ajv = new AjvCtor({ allErrors: true, strict: false });
let structural: ValidateFunction | null = null;

/**
 * The wire schema keeps id lists as arrays (structured-output-friendly), but the
 * brief's spec examples also allow a bare string. Normalize before validating.
 */
export function normalizeSpec(spec: unknown): unknown {
  if (typeof spec !== "object" || spec === null) return spec;
  const clone = JSON.parse(JSON.stringify(spec)) as { commands?: Command[] };
  const toList = (v: string[] | string | undefined): string[] | undefined => (typeof v === "string" ? [v] : v);
  for (const cmd of clone.commands ?? []) {
    if (!cmd) continue;
    if (cmd.draw !== undefined) cmd.draw = toList(cmd.draw);
    if (cmd.show !== undefined) cmd.show = toList(cmd.show);
    if (cmd.hide !== undefined) cmd.hide = toList(cmd.hide);
    if (cmd.erase !== undefined) cmd.erase = toList(cmd.erase);
    if (cmd.clear?.keep !== undefined) cmd.clear.keep = toList(cmd.clear.keep);
    if (cmd.highlight) cmd.highlight.target = toList(cmd.highlight.target)!;
    if (cmd.move) cmd.move.target = toList(cmd.move.target)!;
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

  const VERBS = ["speak", "draw", "pause", "show", "hide", "erase", "clear", "highlight", "point", "move", "camera"] as const;
  for (const [i, cmd] of (spec.commands ?? []).entries()) {
    const kinds = VERBS.filter((k) => (cmd as Command)[k] !== undefined);
    if (kinds.length !== 1) {
      errors.push(`commands[${i}] must set exactly one verb of ${VERBS.join("/")} (got: ${kinds.join(", ") || "none"})`);
      continue;
    }
    const verb = kinds[0];
    if (cmd.blocking !== undefined && verb !== "speak") errors.push(`commands[${i}]: blocking only applies to speak`);
    if (cmd.parallel !== undefined && verb !== "draw" && verb !== "erase") errors.push(`commands[${i}]: parallel only applies to draw/erase`);
    if (verb === "move" && !cmd.move!.by && !(cmd.move!.path && cmd.move!.path.length > 0)) {
      errors.push(`commands[${i}]: move needs by ([dx, dy]) or a non-empty path`);
    }
    if (verb === "point") {
      const at = cmd.point!.at;
      if (!at || (at.ref === undefined && (at.x === undefined || at.y === undefined))) {
        errors.push(`commands[${i}]: point.at needs ref (an element id) or x+y coordinates`);
      }
    }
    if (verb === "camera" && !cmd.camera!.reset && cmd.camera!.center === undefined && cmd.camera!.zoom === undefined) {
      errors.push(`commands[${i}]: camera needs center, zoom, or reset:true`);
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
