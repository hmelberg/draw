// Fixed logical canvas: 1000×750, Cartesian, y-up, origin bottom-left.
// The single y-flip to SVG space happens in the backend (see toSvgY), nowhere else.

export const CANVAS = { w: 1000, h: 750 } as const;

/** Default plot-area margins (logical units) for diagrams with axes. */
export const PLOT_MARGIN = { left: 120, right: 70, top: 55, bottom: 95 } as const;

export interface PlotArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function plotArea(): PlotArea {
  return {
    x0: PLOT_MARGIN.left,
    y0: PLOT_MARGIN.bottom,
    x1: CANVAS.w - PLOT_MARGIN.right,
    y1: CANVAS.h - PLOT_MARGIN.top,
  };
}

/** The one y-flip: logical y-up → SVG y-down. Backends call this at emission time only. */
export function toSvgY(y: number): number {
  return CANVAS.h - y;
}

/** Linear domain → logical scale. */
export function linearScale(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}
