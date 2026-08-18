# Roadmap & status

Milestones from [BRIEF.md](BRIEF.md). Status as of 2026-08-18 (initial build session).

## Milestone status

| Milestone | Status | Notes |
|---|---|---|
| **M1** schema + custom-svg + supply_demand + gradual drawing + command sequence + playback modes + captions | **Done** | End-to-end with BYOK generation; bundled offline examples too |
| **M2** decision_tree (d3-hierarchy) + label collision solver + visual lint | **Done** | Greedy candidate solver with leader lines; lint feeds Loop-1 repair |
| **M3** playback polish: step fwd/back, speed multiplier, voice selection, speech fallbacks | **Done** | Step-back re-renders instantly up to the command index |
| **M4** jsxgraph + mermaid backends; side-by-side harness; benchmark + logging + ratings/tags | **Done (jsxgraph minimal)** | Mermaid: tree family only (by design). JSXGraph: renders the shared layout IR as curves/points — *not yet* the relational/draggable construction; see open questions |
| **M5** spec diffs / tweened mutation; vision critic | **Not started** | `update(diff)` currently re-renders without tweening (honest stub on the render contract) |
| **M6** exemplar library + meta-improvement variants + improvement packet + analysis view | **Partial** | Exemplar library (promote + keyword-similarity few-shots) and improvement-packet export (without PNG screenshots) are in; meta-improvement runs and the analysis view are not |

## Deliberately deferred / open questions (flagged, not blocking)

1. **Tier-2 function strings** — implemented via a tiny sandboxed expression evaluator
   (`src/spec/expression.ts`, recursive descent, never `eval`). Resolved: yes, allow them.
2. **JSXGraph vs. hand-drawn look** — current adapter draws the shared layout IR onto a JSXGraph
   board, which proves the plumbing but gives neither interactivity nor sketchiness. The
   relational construction (functiongraph + intersection + draggable curves) is the real
   experiment and still open. Early signal: JSXGraph styling is CSS-flat; interactivity and the
   rough.js aesthetic likely live in different backends for now.
3. **Narration as separate LLM pass** — single-pass, per the brief's starting position.
4. **Simultaneous speech+drawing** — deferred exactly as specified (`"blocking": false` extension).
5. **Vision critic (Loop 1.3)** — not built; the hook point is `generate()`'s repair loop in
   `src/llm/compile.ts`.
6. **Improvement packet PNG screenshots** — packet exports specs + lint + ratings + aggregate
   stats, but not rasterized PNGs (localStorage cost); add rasterize-on-export later.
7. **General DAG layout (dagre/ELK)** — tier-2 `node`/`edge` without tree structure uses a
   deterministic circle layout; good enough for Markov/network prompts, revisit when the packet
   shows demand.
8. **Excalidraw export** — not built (explicitly low priority in the brief).
9. **Mermaid** — narrow by design: decision_tree family only, instant render, no animation.
