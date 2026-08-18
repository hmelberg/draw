# Build Brief: "Concept Sketch" — an experimental LLM→drawing-spec app

> This is the founding document of the repo, verbatim as delivered. Where details are
> unspecified, the implementation chooses the simplest thing that preserves the
> architecture below. Status per milestone lives in [ROADMAP.md](ROADMAP.md).

## Purpose

Build an experimental web app for testing how well an LLM can translate a short textual request ("draw a demand and supply diagram", "draw a decision tree for a health economic evaluation") into a **structured drawing specification** that deterministic code renders as an attractive, animated, optionally narrated educational illustration.

The app is an **experiment harness first, product second**. Its job is to let us compare several spec formats and rendering backends side by side on the same prompts, so we can decide empirically what to invest in.

The end user of this brief is Claude Code: treat it as the founding document of the repo. Where details are unspecified, choose the simplest thing that preserves the architecture below.

## Core architectural principle (non-negotiable)

**The LLM writes semantics; deterministic code computes geometry.**

LLMs fail at pixel-space reasoning: they overlap labels, misjudge text widths, and confuse coordinate conventions. Therefore:

- The LLM's output is a JSON spec describing *what exists* and *how elements relate* (qualitative shapes, attachments, relative positions, ordering).
- All actual coordinates are computed by renderer code: D3-style scales for curve diagrams, tree/graph layout algorithms for node diagrams, a collision solver for labels.
- A raw-coordinate escape hatch exists but is a last resort, and even it uses the logical coordinate system below — never screen pixels.

## Coordinate system

- **Fixed logical canvas**: 1000 × 750 logical units, fixed aspect ratio. Not percentages of the container — non-uniform stretching distorts geometry (circles become ellipses, slopes change).
- **Cartesian, y-up, origin bottom-left.** The renderer applies the y-flip exactly once (single transform), so the LLM and all spec math live in the coordinate world the LLM naturally assumes.
- **Responsive scaling via SVG `viewBox="0 0 1000 750"`** — uniform scaling to any container size, letterboxed if needed. Font sizes in logical units so text scales with the drawing.
- For quantitative diagrams, specs may declare **domain coordinates** (e.g. price 0–50, quantity 0–1000) plus axis ranges; the renderer maps domain → logical via linear scales. This is the LLM's most natural way to think about e.g. a demand curve.

## The spec format (single format the LLM ever sees)

One JSON format, validated by a JSON Schema, with three tiers. Use structured output / tool-calling so malformed JSON is impossible; the schema doubles as prompt documentation.

### Tier 1 — Scene templates

Parameterized whole-diagram types. Initial set (implement the first two fully; stub the rest):

1. `supply_demand` — axes (P, Q), demand and supply curves with qualitative slope/curvature params, optional equilibrium point with dashed guide lines, optional shifted curves (D→D′) with shift arrows, optional shaded regions (consumer/producer surplus, deadweight loss), all labels.
2. `decision_tree` — decision/chance/terminal nodes, branch probabilities and payoffs/costs, health-economics conventions (squares/circles/triangles).
3. Stubs for later: `cost_effectiveness_plane`, `markov_model`, `two_by_two_table`, `timeline`, `generic_axes_diagram`.

**Every scene is split into two artifacts:**

- **Manifest (data — improvable by Loop 2)**: `scenes/<name>/manifest.json` containing the scene's name, a natural-language description of what it depicts and when to choose it, the parameter schema (with per-parameter descriptions), and 1–2 usage examples (request → params). The **scene catalog** (all manifests) is injected into the LLM prompt; the LLM routes a request to a scene by reading these descriptions. Mis-routing or parameter misuse is therefore fixed by improving manifests, not code.
- **Layout code (code — improvable by Loop 3)**: the deterministic module that turns validated params into geometry.

Scene routing failures fall through to Tier 2 gracefully (never hard-fail because no scene matched).

### Tier 2 — Semantic primitives

For untemplated diagrams: `axes`, `curve` (qualitative: direction, curvature, steepness, or an explicit function string over the domain), `point` (defined relationally, e.g. intersection of two curves), `arrow_between(a, b)`, `label(attached_to, preferred_side)`, `region(between)`, `node`, `edge`.

### Tier 3 — Raw primitives

`path`, `text`, `shape` with explicit logical coordinates. Escape hatch only.

### Cross-cutting element properties

Every element supports: `id` (for later mutation), `style` (color, strokeWidth, sketchiness/roughness, fill, dash), and `draw` (mode: `instant` | `sketch`; duration; easing; order).

### Timeline / narration (KEY FEATURE — gradual drawing + synchronized speech)

Gradual, handwriting-style drawing and spoken narration are core features, not extras. The spec's top level contains a flat **command sequence** — the v1 model is deliberately simple:

```json
{
  "canvas": {"width": 1000, "height": 750},
  "template": "supply_demand",
  "params": { ... },
  "commands": [
    {"speak": "Start with price on the vertical axis and quantity on the horizontal."},
    {"draw": "axes"},
    {"speak": "Demand slopes downward: as price falls, quantity demanded rises."},
    {"draw": ["demand_curve", "label_D"]},
    {"speak": "Where the curves cross, the market clears."},
    {"draw": ["equilibrium_point", "guide_lines"]}
  ]
}
```

**Execution rule (the invariant):** commands run strictly in sequence; each command completes before the next begins. A `speak` completes when its utterance ends (`utterance.onend`); a `draw` completes when its animation ends. A `pause` command (seconds) is available for pacing.

**Groups and mixed animation (both v1 — they're cheap):**

- A `draw` command with a list of ids IS a group. Default: the listed elements animate one after another. With `"parallel": true`, they animate simultaneously; the command completes when the slowest finishes (`Promise.all`). No separate group concept needed — the command boundary defines the group.
- Each element's own `draw` property (`mode: "sketch" | "instant"`, `duration`) is respected inside any command, so one command can mix instantly-appearing elements with gradually drawn ones (e.g. `{"draw": ["gridlines", "demand_curve"], "parallel": true}` where gridlines are `instant` and the curve sketches over 2s). An instant element is simply a zero-duration animation.

Note that "speak before drawing" and "speak after drawing" fall out of command ordering — no timing enum needed. Simultaneous speech+drawing ("during") is deferred: if wanted later, add an optional `"blocking": false` on a speak command (start speaking, proceed immediately) — a one-attribute extension that breaks nothing.

**Global playback modes** (user controls, override command behavior):

- `narrated` (default): full behavior above.
- `silent`: draw commands animate with their durations; speak commands are skipped (their captions still shown briefly).
- `instant`: entire figure rendered at once — no animation, no speech ("draw all at once").

Plus: play/pause, step forward/back (command-level), speed multiplier (scales animation durations and speech rate).

**Captions:** always render the current `speak` text as a synchronized caption below/over the canvas (covers silent mode, unsupported browsers, accessibility).

**Web Speech API implementation notes:**

- Speech synthesis must be initiated from a user gesture in several browsers — playback starts from an explicit play button, never autoplay.
- Sync at **utterance granularity** using `utterance.onend` (reliable cross-browser). Do NOT attempt word-level sync in v1; `onboundary` support is inconsistent.
- Voices load asynchronously (`voiceschanged`); expose voice + rate selection in settings (Norwegian and English voices both matter).
- Handle speech errors/unavailability by falling back to caption display with a reading-time estimate per speak command.

### Mutation

A follow-up request ("now shift demand right") produces a **spec diff** (changed params / added elements referencing existing `id`s), and the renderer tweens between old and new geometry (interpolate paths/positions). Keep the semantic model live in app state; never treat rendered SVG as the source of truth.

## Rendering backends (the experiment variable)

Behind the single spec, implement pluggable backends so the same spec (or same prompt) can be rendered several ways side by side:

1. **`custom-svg`** (primary): hand-rolled SVG. D3 scales + function sampling for curves; **rough.js** for the hand-drawn aesthetic; **stroke-dasharray/dashoffset** animation for progressive "handwritten" drawing; label collision avoidance (start with greedy candidate positions: above-right → below-right → above-left → below-left → leader line; deterministic bounding-box overlap checks using measured text extents).
2. **`jsxgraph`**: adapter mapping the spec's Tier-2 primitives onto JSXGraph's relational construction model (functiongraph, intersection points, glider labels). This backend is the path to *interactive* diagrams (draggable curves updating equilibrium live). Expect to adapt/wrap it; note where its styling limits the hand-drawn look.
3. **`mermaid`** (narrow): only for the tree/flow family, to benchmark its automatic layout against ours. Known limits: no continuous curves, weak animation control — that's fine; it's a baseline, not a candidate for the whole system.
4. **(Optional, later) `plotly`**: only if genuine data plots become a use case.

Also add an **`export-excalidraw`** function (spec → Excalidraw JSON) so a user can hand-edit results — low priority, nice to have.

For **tree/graph layout** in the custom backend, use a proper algorithm (d3-hierarchy tidy tree for decision trees; dagre or ELK if general DAGs are needed). Never let the LLM place nodes.

## Anti-ugliness rules (renderer-enforced, LLM cannot violate)

- Labels always attach to elements with a preferred side; collision solver decides final placement; leader lines when displaced far.
- Minimum spacing constants, automatic canvas margins, font-size floor.
- Text never sits on a stroke; shaded regions always behind strokes; strokes behind labels.
- Sketchy (rough.js) styling by default for concept diagrams — forgiving of imperfection.

## Self-improvement loops (three timescales)

The app is a learning system. Improvement happens at three timescales with different automation levels; keep them architecturally distinct.

### Loop 1 — within a generation (automatic, seconds)

1. **Schema validation** (ajv) before rendering; on failure, feed the validation errors back to the LLM for one repair round.
2. **Deterministic visual lint** after layout: bounding-box overlap detection (label–label, label–stroke), elements outside canvas, unreadable font sizes. Violations reported as structured text and fed back for one repair round ("label 'Equilibrium' overlaps supply curve — choose a different preferred_side").
3. **Vision critic**: rasterize the rendered SVG to PNG in-browser (canvas + toDataURL) and send it to the Claude API (vision) with a fixed rubric — overlaps, readability, whether the figure correctly depicts the requested concept, aesthetic score. Critique drives a final repair round and is logged as a machine quality score. Toggleable (it costs an extra API call per generation); always on for benchmark runs.

Cap total repair rounds (e.g. 2) to bound cost/latency; log every round.

### Loop 2 — across generations: prompts and exemplars (semi-automatic, runs in-app)

Prompts and few-shot examples are *data*, so the app can improve them at runtime without code changes:

- **Exemplar library**: a "promote to exemplar" button on any highly rated result stores its (user prompt, final spec) pair. At generation time, include the 3 most similar exemplars (simple keyword/embedding similarity) as few-shot examples. This is the main channel by which the system gets better at *your* diagram styles.
- **Meta-improvement runs**: on demand, feed a batch of logged failures (specs, lint output, critic verdicts, human ratings/tags) to Claude with the current system prompt and ask it to propose a revised prompt and/or new lint rules. Proposals become new **prompt variants** in the A/B harness — never silent replacements. The benchmark set decides whether a variant wins; the human confirms promotion to default.
- **Scene manifest refinement**: when logs show mis-routing (wrong scene chosen) or parameter misuse, meta-improvement runs propose revised scene descriptions/parameter docs/examples in the manifests — tested as variants on the benchmark like prompt variants.
- All prompt variants, exemplars, manifests, and their benchmark scores are versioned in the local store and exportable as JSON.

### Loop 3 — renderer code and templates (needs a dev loop, app prepares the handoff)

Code must not self-modify in the browser. Instead the app generates an **improvement packet**: an exportable bundle containing the N worst-rated cases (prompt, spec, PNG screenshot, lint + critic output, human tags) plus aggregate failure statistics per diagram family and failure type ("Tier-2 label placement fails 60%", "no template fits network-style prompts"). This file is handed to a Claude Code session, which fixes renderer code or authors the next template. Optimize the packet format so that hand-off is near-turnkey.

**New-scene pipeline**: the packet clusters untemplated (Tier-2) prompts to reveal which scene to author next. As a bootstrap shortcut, any well-rated Tier-2 result can seed a new scene: the app asks Claude to draft a manifest + layout-code skeleton from that spec, included in the packet as a pre-written starting point for the Claude Code session.

### Human input (deliberately minimal, all one-click)

- Rating 1–5 ("would use in teaching") per result.
- Failure tags from a fixed taxonomy: `overlap`, `bad-label-placement`, `wrong-shape`, `wrong-concept`, `ugly-style`, `animation-issue`, `other`+comment.
- "Promote to exemplar" and "promote prompt variant to default" decisions.

These ratings/tags are the supervision signal for Loops 2 and 3; store them with full provenance (model, prompt variant, backend, spec version).

Log every generation (prompt, spec, validation result, lint result, render time) to local JSON files for the experiment analysis.

## LLM integration

- A single "compiler" prompt: system prompt states the coordinate convention explicitly ("(0,0) is bottom-left; y increases upward"), embeds the JSON Schema, and includes 3–4 few-shot examples (one templated econ diagram, one decision tree, one Tier-2 composition, one with narration steps).
- Use the Anthropic API with structured output. Make the model configurable.
- **Bring-your-own-key, fully client-side**: a settings field where the user pastes their Anthropic API key. Store it in `localStorage` only (with a "clear key" button and a note that it never leaves the browser except in requests to api.anthropic.com). Call the Messages API directly from the browser — this requires the header `anthropic-dangerous-direct-browser-access: true` (Anthropic's supported CORS mechanism for exactly this pattern). No server or proxy at all.
- Main UI flow: text input box ("Describe the drawing…") → generate button → API call produces the spec → spec is shown in a collapsible JSON panel (editable, with a re-render button, so specs can be hand-tweaked during experiments) → renderer draws it below with playback controls.
- Handle API errors visibly (invalid key, rate limits, refusals) in the UI, and feed schema/lint failures back for the one repair round described above.
- Design the prompt files as data (e.g. `prompts/*.md`) so variants can be A/B compared in the harness.

## The experiment harness (the actual app)

A simple web UI with:

- A prompt box + "generate" button; model and backend selectors.
- **Side-by-side mode**: run one prompt through N configurations (backend × prompt-variant) and render results in a grid with per-cell lint scores and generation metadata.
- A **fixed benchmark set** of ~10 prompts, runnable as a batch, results saved and browsable:
  1. Draw a demand and supply diagram.
  2. Show why a price ceiling creates a shortage.
  3. Show the deadweight loss from a tax, with shaded regions.
  4. Draw a decision tree comparing surgery vs. medication with probabilities and QALY payoffs.
  5. Draw a Markov model with Healthy, Sick, Dead states.
  6. Draw a cost-effectiveness plane and mark a dominant intervention.
  7. Illustrate diminishing marginal utility.
  8. Draw a 2×2 table for sensitivity and specificity.
  9. Draw a timeline of a screening program from invitation to diagnosis. (curveball)
  10. Illustrate herd immunity as a network of people. (curveball — no template will fit)
- Per-result human rating buttons (1–5 on "would use in teaching") persisted alongside the logs.
- Playback controls for the timeline/narration on each rendered result.

Success criterion for the experiment: for each diagram family, which configuration most often produces figures **better than what the LLM produces unaided** (raw SVG baseline — include it as backend 0 for honesty).

## Tech choices

- Vite + vanilla TypeScript (or minimal React if it genuinely helps the harness UI — keep the renderer itself framework-free so it can later become a web component `<concept-sketch>`).
- Dependencies: rough.js, d3-scale/d3-shape/d3-hierarchy, ajv, jsxgraph, mermaid, (dagre or elkjs if needed).
- Renderer module boundary: `render(spec, container, options) -> { timeline, update(diff), lint() }` — this is the future web-component contract.
- No backend server at all: user-supplied API key, direct browser calls to the Anthropic API (see LLM integration). The whole app is static files, deployable to any static host.

## Milestones

1. **M1**: Schema + `custom-svg` backend + `supply_demand` template + dash-offset gradual drawing + blocking command sequence (speak/draw/pause, three playback modes, captions). One prompt end-to-end. Narration and gradual drawing are key features — they belong in the first slice, not later.
2. **M2**: `decision_tree` template with d3-hierarchy layout; label collision solver; visual lint.
3. **M3**: Playback polish: step forward/back, speed multiplier, voice selection, speech fallbacks.
4. **M4**: JSXGraph and Mermaid backends; side-by-side harness; benchmark set + logging + ratings/tags.
5. **M5**: Spec diffs / mutation with tweened transitions ("shift demand right"); vision critic (Loop 1.3).
6. **M6**: Exemplar library + meta-improvement prompt variants (Loop 2); improvement-packet export (Loop 3); analysis view over logged results.

## Open questions to resolve during the build (flag, don't block)

- Whether Tier-2 curve descriptions should allow explicit function strings (`"P = 100 - 0.5*Q"`) in addition to qualitative shapes — probably yes, sandboxed via a tiny expression evaluator, never `eval`.
- How far JSXGraph can be styled toward the rough.js aesthetic, or whether interactivity and hand-drawn look must live in different backends for now.
- Whether narration text should be a separate LLM pass (better pedagogy?) or part of the single spec generation (simpler, keeps sync trivial) — start with single-pass.
