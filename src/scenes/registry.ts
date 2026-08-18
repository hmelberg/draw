// Scene registry: manifests are data (Loop 2 improves them); layout code is
// code (Loop 3 improves it). Stub scenes appear in the catalog so the LLM
// knows to fall through to tier-2 composition.

import type { SceneLayout, SceneManifest } from "./types";
import supplyDemandManifest from "./supply_demand/manifest.json";
import decisionTreeManifest from "./decision_tree/manifest.json";
import cepManifest from "./cost_effectiveness_plane/manifest.json";
import markovManifest from "./markov_model/manifest.json";
import twoByTwoManifest from "./two_by_two_table/manifest.json";
import timelineManifest from "./timeline/manifest.json";
import genericAxesManifest from "./generic_axes_diagram/manifest.json";
import { layoutSupplyDemand, type SupplyDemandParams } from "./supply_demand/layout";
import { layoutDecisionTree, type DecisionTreeParams } from "./decision_tree/layout";
import { layoutQalyProfiles, type QalyParams } from "./qaly_profiles/layout";
import qalyManifest from "./qaly_profiles/manifest.json";

export interface SceneModule {
  manifest: SceneManifest;
  layout?: (params: Record<string, unknown>) => SceneLayout;
}

export const scenes: Record<string, SceneModule> = {
  supply_demand: {
    manifest: supplyDemandManifest as SceneManifest,
    layout: (params) => layoutSupplyDemand(params as SupplyDemandParams),
  },
  decision_tree: {
    manifest: decisionTreeManifest as SceneManifest,
    layout: (params) => layoutDecisionTree(params as unknown as DecisionTreeParams),
  },
  qaly_profiles: {
    manifest: qalyManifest as SceneManifest,
    layout: (params) => layoutQalyProfiles(params as QalyParams),
  },
  cost_effectiveness_plane: { manifest: cepManifest as SceneManifest },
  markov_model: { manifest: markovManifest as SceneManifest },
  two_by_two_table: { manifest: twoByTwoManifest as SceneManifest },
  timeline: { manifest: timelineManifest as SceneManifest },
  generic_axes_diagram: { manifest: genericAxesManifest as SceneManifest },
};

/** The scene catalog injected into the compiler prompt ({{CATALOG}}). */
export function sceneCatalogText(): string {
  const parts: string[] = [];
  for (const { manifest } of Object.values(scenes)) {
    if (manifest.status === "ready") {
      parts.push(
        `### Scene template: ${manifest.name} (READY — prefer this when it fits)\n` +
          `${manifest.description}\n` +
          `Parameter schema:\n${JSON.stringify(manifest.params_schema, null, 1)}\n` +
          `Element ids your commands can reference:\n` +
          Object.entries(manifest.element_ids)
            .map(([id, doc]) => `- ${id}: ${doc}`)
            .join("\n") +
          (manifest.examples.length > 0
            ? `\nExamples:\n` +
              manifest.examples
                .map((ex) => `Request: "${ex.request}" → params: ${JSON.stringify(ex.params)}`)
                .join("\n")
            : ""),
      );
    } else {
      parts.push(`### Scene template: ${manifest.name} (STUB — do NOT set template to this)\n${manifest.description}`);
    }
  }
  return parts.join("\n\n");
}
