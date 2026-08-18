// Pure command planning: normalizes the spec's command sequence against the
// element ids that layout actually produced. Backend-independent, fully tested.

import type { Command } from "../spec/types";

export type PlanStep =
  | { kind: "speak"; text: string }
  | { kind: "draw"; ids: string[]; parallel: boolean; implicit?: boolean }
  | { kind: "pause"; seconds: number };

export interface Plan {
  steps: PlanStep[];
  /** drawnUpTo[i] = ids visible after steps[0..i] have completed (for step back). */
  drawnUpTo: string[][];
  warnings: string[];
}

export function planCommands(commands: Command[] | undefined, allIds: string[]): Plan {
  const known = new Set(allIds);
  const steps: PlanStep[] = [];
  const warnings: string[] = [];
  const mentioned = new Set<string>();

  for (const cmd of commands ?? []) {
    if (cmd.speak !== undefined) {
      steps.push({ kind: "speak", text: cmd.speak });
    } else if (cmd.draw !== undefined) {
      const requested = typeof cmd.draw === "string" ? [cmd.draw] : cmd.draw;
      const ids = requested.filter((id) => {
        if (known.has(id)) return true;
        warnings.push(`draw command references unknown id "${id}" (dropped)`);
        return false;
      });
      ids.forEach((id) => mentioned.add(id));
      steps.push({ kind: "draw", ids, parallel: cmd.parallel === true });
    } else if (cmd.pause !== undefined) {
      steps.push({ kind: "pause", seconds: cmd.pause });
    } else {
      warnings.push("command with none of speak/draw/pause skipped");
    }
  }

  const remaining = allIds.filter((id) => !mentioned.has(id));
  if (remaining.length > 0) {
    steps.push({ kind: "draw", ids: remaining, parallel: false, implicit: true });
  }

  const drawnUpTo: string[][] = [];
  const drawn: string[] = [];
  for (const step of steps) {
    if (step.kind === "draw") drawn.push(...step.ids);
    drawnUpTo.push([...drawn]);
  }

  return { steps, drawnUpTo, warnings };
}
