import { type PlotArea } from "./canvas";
import {
  Z_STROKE,
  Z_TEXT,
  defaultDrawOpts,
  defaultStyle,
  type GroupDrawable,
  type StrokeDrawable,
  type TextDrawable,
} from "./model";

/** L-shaped axes with arrowheads and axis labels, shared by scenes and tier 2. */
export function makeAxes(id: string, plot: PlotArea, xLabel?: string, yLabel?: string): GroupDrawable {
  const style = defaultStyle({ strokeWidth: 3.5, roughness: 1.1 });
  const children: (StrokeDrawable | TextDrawable)[] = [
    {
      id: `${id}_x`,
      kind: "stroke",
      pts: [
        [plot.x0 - 6, plot.y0],
        [plot.x1 + 22, plot.y0],
      ],
      arrowhead: "end",
      z: Z_STROKE,
      style,
      drawOpts: defaultDrawOpts("sketch", 700),
    },
    {
      id: `${id}_y`,
      kind: "stroke",
      pts: [
        [plot.x0, plot.y0 - 6],
        [plot.x0, plot.y1 + 22],
      ],
      arrowhead: "end",
      z: Z_STROKE,
      style,
      drawOpts: defaultDrawOpts("sketch", 700),
    },
  ];
  if (xLabel) {
    children.push({
      id: `${id}_x_label`,
      kind: "text",
      pos: [(plot.x0 + plot.x1) / 2, plot.y0 - 52],
      text: xLabel,
      fontSize: 26,
      anchor: "middle",
      z: Z_TEXT,
      style: defaultStyle(),
      drawOpts: defaultDrawOpts("instant"),
    });
  }
  if (yLabel) {
    children.push({
      id: `${id}_y_label`,
      kind: "text",
      pos: [plot.x0 + 8, plot.y1 + 40],
      text: yLabel,
      fontSize: 26,
      anchor: "start",
      z: Z_TEXT,
      style: defaultStyle(),
      drawOpts: defaultDrawOpts("instant"),
    });
  }
  return {
    id,
    kind: "group",
    children,
    z: Z_STROKE,
    style,
    drawOpts: defaultDrawOpts("sketch"),
  };
}
