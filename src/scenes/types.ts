import type { Drawable, Pt } from "../layout/model";
import type { LabelRequest } from "../layout/labels";

/** What a scene's deterministic layout code produces. */
export interface SceneLayout {
  drawables: Drawable[];
  labels: LabelRequest[];
  anchors: Record<string, Pt>;
  /** Natural draw order for elements not mentioned in any command. */
  order: string[];
}

/** Scene manifest — data, improvable by Loop 2 without touching code. */
export interface SceneManifest {
  name: string;
  status: "ready" | "stub";
  description: string;
  params_schema: object;
  element_ids: Record<string, string>;
  examples: { request: string; params: Record<string, unknown> }[];
}
