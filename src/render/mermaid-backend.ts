// Mermaid backend — deliberately narrow: only the decision_tree family, as a
// baseline for automatic layout. No animation, no continuous curves (known
// limits per the brief). Loaded on demand (mermaid is a heavy dependency).

import type { BackendModule, MountResult } from "./backend";
import type { Spec } from "../spec/types";
import type { DecisionTreeParams, TreeBranch, TreeNode } from "../scenes/decision_tree/layout";

let counter = 0;

function esc(text: string): string {
  return text.replace(/"/g, "'");
}

function nodeDecl(id: string, node: TreeNode): string {
  const label = esc(node.label);
  if (node.type === "decision") return `${id}["${label}"]`;
  if (node.type === "chance") return `${id}(("${label}"))`;
  const extra = node.payoff !== undefined ? `<br/>${node.payoff}` : "";
  return `${id}[/"${label}${extra}"/]`;
}

function buildFlowchart(root: TreeNode): string {
  const lines: string[] = ["flowchart LR"];
  const walk = (node: TreeNode, path: string) => {
    const id = `n${path}`;
    lines.push(`  ${nodeDecl(id, node)}`);
    (node.children ?? []).forEach((branch: TreeBranch, i: number) => {
      const childId = `n${path}_${i}`;
      const parts: string[] = [];
      if (branch.label) parts.push(esc(branch.label));
      if (branch.probability !== undefined) parts.push(`p=${branch.probability}`);
      const edgeLabel = parts.length > 0 ? `|"${parts.join(" ")}"|` : "";
      lines.push(`  n${path} -->${edgeLabel} ${childId}`);
      walk(branch.node, `${path}_${i}`);
    });
  };
  walk(root, "0");
  return lines.join("\n");
}

export const mermaidBackend: BackendModule = {
  name: "mermaid",
  label: "Mermaid (tree family only)",
  description: "Benchmarks mermaid's automatic flowchart layout against ours. Tree/flow specs only; instant render.",
  supportsAnimation: false,
  appliesTo: (spec: Spec) => spec.template === "decision_tree" && !!spec.params?.root,
  async mount(_layout, spec, container): Promise<MountResult> {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { curve: "basis" } });
    const params = spec.params as unknown as DecisionTreeParams;
    const code = buildFlowchart(params.root);
    const { svg } = await mermaid.render(`cs-mermaid-${counter++}`, code);
    const wrap = document.createElement("div");
    wrap.className = "cs-mermaid";
    wrap.innerHTML = svg;
    container.appendChild(wrap);
    return {
      elements: new Map(),
      destroy: () => wrap.remove(),
    };
  },
};
