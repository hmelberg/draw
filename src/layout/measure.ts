// Text measurement abstraction: the browser backend injects a canvas-based
// measurer (matching the real font); layout code and tests use the heuristic,
// so layout stays deterministic and testable in node.

export interface TextExtent {
  w: number;
  h: number;
}

export type MeasureFn = (text: string, fontSize: number) => TextExtent;

export const heuristicMeasure: MeasureFn = (text, fontSize) => ({
  w: Math.max(1, text.length) * fontSize * 0.52,
  h: fontSize * 1.25,
});
