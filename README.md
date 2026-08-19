# Concept Sketch (`draw`)

An experimental web app testing how well an LLM can translate a short request
("draw a demand and supply diagram") into a **structured drawing spec** that
deterministic code renders as an animated, narrated, hand-drawn educational
figure. Experiment harness first, product second — see [BRIEF.md](BRIEF.md)
(the founding document) and [ROADMAP.md](ROADMAP.md) (milestone status).

**Live app:** https://hmelberg.github.io/draw/

## Core principle

**The LLM writes semantics; deterministic code computes geometry.** The LLM
outputs a JSON spec (what exists, how elements relate); scales, tree layout,
label collision solving, and lint are all code. Logical canvas 1000×750,
Cartesian, y-up, origin bottom-left; the single y-flip lives in `toSvgY`.

## Using it

1. Open the app, press **Settings**, paste your Anthropic API key
   (stored in `localStorage` only; sent only to `api.anthropic.com` — direct
   browser calls via Anthropic's supported CORS mechanism; no server at all).
2. Describe a drawing → **Generate**. The spec appears in an editable JSON
   panel; the figure renders below with play/pause, step, mode
   (narrated/silent/instant) and speed controls.
3. **Compare configs** runs one prompt through backends × prompt variants
   side by side. **Run benchmark** runs the fixed 10-prompt set and logs
   everything. Rate results (1–5), tag failures, promote good ones to
   exemplars (used as few-shots for similar future prompts).
4. **Offline example** renders a bundled spec without any API key.

No key? Everything except generation works — try the offline examples.

## Architecture map

| Path | What |
|---|---|
| `src/spec/` | Spec types, JSON Schema (= API output constraint = prompt docs), sandboxed expression evaluator |
| `src/layout/` | Canvas/scales, layout IR, tier-2/3 element layout, label collision solver, orchestrator |
| `src/scenes/<name>/` | `manifest.json` (routing data, Loop 2) + `layout.ts` (geometry code, Loop 3) |
| `src/lint/` | Deterministic visual lint (feeds the Loop-1 repair round) |
| `src/render/` | Command planner (scene state per step), Player (speak/draw/pause + gesture verbs: highlight, point, move, show/hide/erase, clear, camera), speech, backends (custom-svg/rough.js, jsxgraph, mermaid) |
| `src/llm/` | BYOK Anthropic client, generation pipeline with capped repair rounds, prompts-as-data (`prompts/*.md`), raw-SVG baseline |
| `src/harness/` | UI cards, benchmark set, logs/exemplars/improvement-packet store |

Renderer boundary: `render(spec, container, options) → { timeline, update(diff), lint() }`
(`src/render/index.ts`) — framework-free, future `<concept-sketch>` web component.

## Development

```bash
npm install
npm test        # vitest — all core logic is covered
npm run dev     # vite dev server
npm run build   # tsc + vite build (deployed to GitHub Pages on push to main)
```

## Improvement loops

- **Loop 1** (automatic, per generation): schema validation → visual lint →
  capped LLM repair rounds. Vision critic not yet built (ROADMAP).
- **Loop 2** (in-app data): exemplar library, prompt variants
  (`src/llm/prompts/compiler-*.md` — add a file, it appears in the A/B harness),
  scene manifests.
- **Loop 3** (dev loop): "Export improvement packet" produces worst cases +
  failure statistics for a Claude Code session in this repo.
