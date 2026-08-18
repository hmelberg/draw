// JSXGraph backend — minimal v1 adapter: renders the shared layout IR onto a
// JSXGraph board (natively y-up, so no flip needed). This proves the plumbing;
// the real experiment (relational functiongraph construction with draggable
// curves) is still open — see ROADMAP. Styling is notably flatter than
// rough.js: early evidence for the "interactivity vs hand-drawn look" question.

import type { BackendModule, MountResult } from "./backend";
import { CANVAS } from "../layout/canvas";
import { leafDrawables } from "../layout/model";

let counter = 0;

export const jsxgraphBackend: BackendModule = {
  name: "jsxgraph",
  label: "JSXGraph (minimal)",
  description: "Renders the layout IR on a JSXGraph board. Instant render; interactive construction not yet implemented.",
  supportsAnimation: false,
  appliesTo: () => true,
  async mount(layout, _spec, container): Promise<MountResult> {
    const mod = (await import("jsxgraph")) as unknown as Record<string, unknown>;
    const JXG = (mod.default ?? mod.JXG ?? mod) as {
      JSXGraph: {
        initBoard(id: string, opts: object): JsxBoard;
        freeBoard(board: JsxBoard): void;
      };
    };
    const div = document.createElement("div");
    div.id = `cs-jsxgraph-${counter++}`;
    div.className = "cs-jsxgraph";
    container.appendChild(div);

    const board = JXG.JSXGraph.initBoard(div.id, {
      boundingbox: [0, CANVAS.h, CANVAS.w, 0],
      axis: false,
      showNavigation: false,
      showCopyright: false,
      keepAspectRatio: true,
      pan: { enabled: false },
      zoom: { enabled: false },
    });

    for (const d of leafDrawables(layout.drawables)) {
      if (d.kind === "text") {
        board.create("text", [d.pos[0], d.pos[1], d.text], {
          fontSize: Math.round(d.fontSize * 0.7),
          anchorX: d.anchor === "start" ? "left" : d.anchor === "end" ? "right" : "middle",
          anchorY: "middle",
          strokeColor: d.style.color,
          fixed: true,
        });
      } else if (d.kind === "area") {
        board.create(
          "polygon",
          d.pts.map(([x, y]) => [x, y]),
          { fillColor: d.style.fill ?? d.style.color, fillOpacity: 0.3, borders: { visible: false }, vertices: { visible: false }, fixed: true },
        );
      } else if (d.shapeHint?.type === "circle") {
        board.create("circle", [d.shapeHint.c, d.shapeHint.r], {
          strokeColor: d.style.color,
          strokeWidth: d.style.strokeWidth,
          fillColor: d.style.fill ?? "none",
          fillOpacity: d.style.fill ? 1 : 0,
          fixed: true,
        });
      } else if (d.pts.length >= 2) {
        const pts = d.closed ? [...d.pts, d.pts[0]] : d.pts;
        board.create("curve", [pts.map((p) => p[0]), pts.map((p) => p[1])], {
          strokeColor: d.style.color,
          strokeWidth: d.style.strokeWidth,
          dash: d.style.dash ? 2 : 0,
          fixed: true,
        });
      }
    }

    return {
      elements: new Map(),
      destroy: () => {
        JXG.JSXGraph.freeBoard(board);
        div.remove();
      },
    };
  },
};

interface JsxBoard {
  create(kind: string, parents: unknown[], attrs?: object): unknown;
}
