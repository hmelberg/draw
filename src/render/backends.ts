import type { BackendModule } from "./backend";
import { customSvgBackend } from "./svg-backend";
import { jsxgraphBackend } from "./jsxgraph-backend";
import { mermaidBackend } from "./mermaid-backend";

export const backendRegistry: Record<string, BackendModule> = {
  "custom-svg": customSvgBackend,
  jsxgraph: jsxgraphBackend,
  mermaid: mermaidBackend,
};

/** Backend 0 for honesty: the raw-SVG baseline is not a spec backend — it asks
 * the LLM for an SVG directly and lives in src/llm/baseline.ts. The harness
 * treats it as a configuration alongside these. */
export const RAW_BASELINE_NAME = "raw-svg-baseline";
