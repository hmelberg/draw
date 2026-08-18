// The renderer module boundary (future web-component contract):
// render(spec, container, options) -> { timeline, update(diff), lint() }.
// Framework-free by design.

import { layoutSpec, type LayoutResult } from "../layout/layout";
import type { LintIssue } from "../lint/lint";
import type { Spec } from "../spec/types";
import { planCommands, type Plan } from "./plan";
import { Player, type PlaybackMode, type PlayerCallbacks } from "./player";
import { SpeechManager } from "./speech";
import { backendRegistry } from "./backends";
import { makeBrowserMeasure } from "./svg-backend";

export interface RenderOptions {
  backend?: string;
  mode?: PlaybackMode;
  speed?: number;
  speech?: SpeechManager;
  callbacks?: PlayerCallbacks;
}

export interface RenderHandle {
  timeline: Player;
  layout: LayoutResult;
  plan: Plan;
  spec: Spec;
  backendName: string;
  backendApplies: boolean;
  lint(): LintIssue[];
  /**
   * M5 stub: applies a shallow spec diff and re-renders in place.
   * Tweened transitions between old and new geometry are not implemented yet.
   */
  update(diff: Partial<Spec>): Promise<RenderHandle>;
  destroy(): void;
}

let fontsReady: Promise<void> | null = null;
function ensureFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof document === "undefined" || !("fonts" in document)) return;
    try {
      await Promise.race([
        document.fonts.load("26px 'Patrick Hand'"),
        new Promise((r) => setTimeout(r, 900)),
      ]);
    } catch {
      /* measurement falls back gracefully */
    }
  })();
  return fontsReady;
}

export async function render(spec: Spec, container: HTMLElement, options: RenderOptions = {}): Promise<RenderHandle> {
  await ensureFonts();
  const backendName = options.backend ?? "custom-svg";
  const backend = backendRegistry[backendName];
  if (!backend) throw new Error(`unknown backend "${backendName}"`);

  const figure = document.createElement("div");
  figure.className = "cs-figure";
  const stage = document.createElement("div");
  stage.className = "cs-stage";
  const caption = document.createElement("div");
  caption.className = "cs-caption cs-caption-empty";
  figure.append(stage, caption);
  container.appendChild(figure);

  const measure = makeBrowserMeasure();
  const layout = layoutSpec(spec, measure);
  const plan = planCommands(spec.commands, layout.order);

  const backendApplies = backend.appliesTo(spec);
  let mounted: Awaited<ReturnType<typeof backend.mount>>;
  if (backendApplies) {
    mounted = await backend.mount(layout, spec, stage);
  } else {
    const note = document.createElement("div");
    note.className = "cs-backend-note";
    note.textContent = `The ${backend.label} backend does not support this diagram family (by design — see BRIEF).`;
    stage.appendChild(note);
    mounted = { elements: new Map(), destroy: () => note.remove() };
  }

  if (!backend.supportsAnimation) {
    // Static backends show everything at mount; the player only sequences narration.
    for (const el of mounted.elements.values()) el.finish();
  }

  const speech = options.speech ?? new SpeechManager();
  const player = new Player(
    plan,
    backend.supportsAnimation ? mounted.elements : new Map(),
    speech,
    caption,
    { mode: options.mode, speed: options.speed },
    options.callbacks,
  );

  const handle: RenderHandle = {
    timeline: player,
    layout,
    plan,
    spec,
    backendName,
    backendApplies,
    lint: () => layout.issues,
    update: async (diff) => {
      player.dispose();
      mounted.destroy();
      figure.remove();
      const next = await render({ ...spec, ...diff }, container, options);
      Object.assign(handle, next);
      return handle;
    },
    destroy: () => {
      player.dispose();
      mounted.destroy();
      figure.remove();
    },
  };
  return handle;
}
