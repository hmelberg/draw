// The Player executes the command plan under the invariant: commands run
// strictly in sequence, each completes before the next begins (the one
// deliberate exception: speak with blocking:false starts narration and moves
// on). Supports the three global playback modes, play/pause, command-level
// stepping, and a live speed multiplier. Scrubbing applies the plan's
// precomputed scene state (visibility, offsets, camera) at any boundary.

import type { Plan, SceneState } from "./plan";
import { INITIAL_STATE } from "./plan";
import type { BackendEffects, RenderedElement } from "./backend";
import { EASINGS, FULL_CANVAS_BOX, lerpBox, pathPosition, pointerPath, unionBoxes } from "./effects";
import type { BBox } from "../layout/geometry";
import type { Pt } from "../layout/model";
import { SpeechManager } from "./speech";

export type PlaybackMode = "narrated" | "silent" | "instant";
export type PlayerState = "idle" | "playing" | "paused" | "done";

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
}

const ERASE_SPEED = 0.55; // erasing runs faster than drawing
const CLEAR_MS = 550;

export class Player {
  private plan: Plan;
  private elements: Map<string, RenderedElement>;
  private speech: SpeechManager;
  private captionEl: HTMLElement | null;
  private effects: BackendEffects | null;
  /** Settable after construction (the harness wires its controls in later). */
  callbacks: PlayerCallbacks;

  private mode: PlaybackMode;
  private speedVal: number;
  private pausedFlag = false;
  private ac: AbortController | null = null;
  /** Boundary: number of fully completed steps. */
  private completed = 0;
  state: PlayerState = "idle";

  constructor(
    plan: Plan,
    elements: Map<string, RenderedElement>,
    speech: SpeechManager,
    captionEl: HTMLElement | null,
    opts: { mode?: PlaybackMode; speed?: number; effects?: BackendEffects } = {},
    callbacks: PlayerCallbacks = {},
  ) {
    this.plan = plan;
    this.elements = elements;
    this.speech = speech;
    this.captionEl = captionEl;
    this.effects = opts.effects ?? null;
    this.callbacks = callbacks;
    this.mode = opts.mode ?? "narrated";
    this.speedVal = opts.speed ?? 1;
    this.hideAll();
  }

  get totalSteps(): number {
    return this.plan.steps.length;
  }

  get position(): number {
    return this.completed;
  }

  setSpeed(x: number): void {
    this.speedVal = x;
  }

  setMode(mode: PlaybackMode): void {
    this.mode = mode;
    if (mode === "instant") this.renderUpTo(this.plan.steps.length);
  }

  async play(): Promise<void> {
    if (this.state === "playing") return;
    if (this.ac && this.state === "paused" && this.pausedFlag) {
      // resume mid-step
      this.pausedFlag = false;
      this.speechSynthResume();
      this.setState("playing");
      return;
    }
    if (this.mode === "instant") {
      this.renderUpTo(this.plan.steps.length);
      return;
    }
    if (this.completed >= this.plan.steps.length) this.renderUpTo(0);

    const ac = new AbortController();
    this.ac = ac;
    this.pausedFlag = false;
    this.setState("playing");
    while (this.completed < this.plan.steps.length && !ac.signal.aborted) {
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
      await this.runStep(this.completed, ac.signal);
      if (ac.signal.aborted) return;
      this.completed++;
      this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    }
    if (!ac.signal.aborted) {
      this.ac = null;
      this.setState("done");
    }
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.pausedFlag = true;
    if (this.speech.available) window.speechSynthesis.pause();
    this.setState("paused");
  }

  stop(): void {
    this.renderUpTo(0);
  }

  stepForward(): void {
    this.renderUpTo(Math.min(this.completed + 1, this.plan.steps.length));
  }

  stepBack(): void {
    this.renderUpTo(Math.max(this.completed - 1, 0));
  }

  /**
   * Poster/thumbnail state: show the finished figure without caption. Pressing
   * play from here restarts from the beginning.
   */
  showPoster(): void {
    this.renderUpTo(this.plan.steps.length);
    this.setCaption("");
  }

  /** Scene state at a step boundary (after steps[0..n-1]). */
  private stateAt(n: number): SceneState {
    return n > 0 ? this.plan.states[n - 1] : INITIAL_STATE;
  }

  /** Jump to a step boundary: apply exactly the scene state after steps[0..n-1]. */
  renderUpTo(n: number): void {
    this.abortRun();
    const scene = this.stateAt(n);
    const visible = new Set(scene.visible);
    for (const [id, el] of this.elements) {
      const [dx, dy] = scene.offsets[id] ?? [0, 0];
      el.setOffset?.(dx, dy);
      if (visible.has(id)) el.finish();
      else el.hide();
    }
    this.effects?.setPointer(null);
    this.effects?.setCamera(scene.camera);
    this.completed = n;
    // Show the most recent narration line at this boundary.
    let caption = "";
    for (let i = 0; i < n; i++) {
      const s = this.plan.steps[i];
      if (s.kind === "speak") caption = s.text;
    }
    this.setCaption(caption);
    this.callbacks.onStep?.(this.completed, this.plan.steps.length);
    this.setState(n >= this.plan.steps.length ? "done" : n === 0 ? "idle" : "paused");
  }

  dispose(): void {
    this.abortRun();
  }

  private abortRun(): void {
    this.pausedFlag = false;
    this.speech.cancel();
    this.ac?.abort();
    this.ac = null;
  }

  private speechSynthResume(): void {
    if (this.speech.available) window.speechSynthesis.resume();
  }

  private setState(s: PlayerState): void {
    this.state = s;
    this.callbacks.onState?.(s);
  }

  private setCaption(text: string): void {
    if (!this.captionEl) return;
    this.captionEl.textContent = text;
    this.captionEl.classList.toggle("cs-caption-empty", text === "");
  }

  private els(ids: string[]): RenderedElement[] {
    return ids.map((id) => this.elements.get(id)).filter((el): el is RenderedElement => el !== undefined);
  }

  private async runStep(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    const before = this.stateAt(index);
    switch (step.kind) {
      case "speak": {
        this.setCaption(step.text);
        if (this.mode === "narrated") {
          const spoken = this.speech.speak(step.text, this.speedVal, signal);
          if (step.blocking) await spoken;
        } else if (step.blocking) {
          // silent: caption still shown briefly
          await this.waitScaled(Math.min(1400, SpeechManager.estimateMs(step.text) * 0.4), signal);
        }
        return;
      }
      case "pause":
        return this.waitScaled(step.seconds * 1000, signal);
      case "draw": {
        const els = this.els(step.ids);
        if (step.parallel) {
          await Promise.all(els.map((el) => this.animateRange(el, 0, 1, el.durationMs, signal)));
        } else {
          for (const el of els) {
            await this.animateRange(el, 0, 1, el.durationMs, signal);
            if (signal.aborted) return;
          }
        }
        return;
      }
      case "show":
        for (const el of this.els(step.ids)) el.finish();
        return;
      case "hide":
        for (const el of this.els(step.ids)) el.hide();
        return;
      case "erase": {
        const els = this.els(step.ids);
        if (step.parallel) {
          await Promise.all(els.map((el) => this.animateRange(el, 1, 0, el.durationMs * ERASE_SPEED, signal)));
        } else {
          for (const el of els) {
            await this.animateRange(el, 1, 0, el.durationMs * ERASE_SPEED, signal);
            if (signal.aborted) return;
          }
        }
        return;
      }
      case "clear": {
        const els = this.els(step.ids);
        await Promise.all(els.map((el) => this.animateRange(el, 1, 0, Math.min(el.durationMs * 0.4, CLEAR_MS), signal)));
        return;
      }
      case "highlight": {
        if (!this.effects) return;
        const effects = this.effects;
        const box = unionBoxes(
          step.ids.flatMap((id) => {
            const b = step.boxes[id];
            if (!b) return [];
            const [dx, dy] = before.offsets[id] ?? [0, 0];
            return [{ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h }];
          }),
        );
        try {
          await this.progress(step.seconds * 1000, signal, (t) => effects.setHighlight(step.ids, step.effect, t, box, step.color));
        } finally {
          effects.endHighlight(step.ids);
        }
        return;
      }
      case "point": {
        if (!this.effects) return;
        const effects = this.effects;
        const [dx, dy] = step.refId ? before.offsets[step.refId] ?? [0, 0] : [0, 0];
        const box: BBox | undefined = step.box && { x: step.box.x + dx, y: step.box.y + dy, w: step.box.w, h: step.box.h };
        const path = pointerPath({ x: step.x + dx, y: step.y + dy, box }, step.gesture);
        try {
          await this.progress(step.seconds * 1000, signal, (t) => effects.setPointer(t >= 1 ? null : path(t)));
        } finally {
          effects.setPointer(null);
        }
        return;
      }
      case "move": {
        const els = this.els(step.ids).filter((el) => el.setOffset);
        const bases = new Map<string, Pt>(els.map((el): [string, Pt] => [el.id, before.offsets[el.id] ?? [0, 0]]));
        const ease = EASINGS[step.easing];
        await this.progress(step.seconds * 1000, signal, (t) => {
          const [px, py] = pathPosition(step.path, ease(t));
          for (const el of els) {
            const [bx, by] = bases.get(el.id)!;
            el.setOffset!(bx + px, by + py);
          }
        });
        return;
      }
      case "camera": {
        if (!this.effects) return;
        const effects = this.effects;
        const from = before.camera ?? FULL_CANVAS_BOX;
        const to = step.box ?? FULL_CANVAS_BOX;
        const ease = EASINGS["ease-in-out"];
        await this.progress(step.seconds * 1000, signal, (t) => effects.setCamera(t >= 1 ? step.box : lerpBox(from, to, ease(t))));
        return;
      }
    }
  }

  /** Reveal/erase an element by animating its progress from `from` to `to`. */
  private animateRange(el: RenderedElement, from: number, to: number, ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      el.setProgress(to);
      return Promise.resolve();
    }
    return this.progress(ms, signal, (t) => el.setProgress(from + (to - from) * t));
  }

  /**
   * Drive onTick(t) with t ∈ [0,1] over a duration, honoring pause and the
   * live speed multiplier. Always ends with onTick(1) unless aborted.
   */
  private progress(ms: number, signal: AbortSignal, onTick: (t: number) => void): Promise<void> {
    if (ms <= 0) {
      onTick(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        const p = Math.min(t / ms, 1);
        onTick(p);
        if (p >= 1) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private waitScaled(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        if (t >= ms) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  private hideAll(): void {
    for (const el of this.elements.values()) el.hide();
  }
}
