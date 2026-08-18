// The Player executes the command plan under the invariant: commands run
// strictly in sequence, each completes before the next begins. Supports the
// three global playback modes, play/pause, command-level stepping, and a live
// speed multiplier.

import type { Plan } from "./plan";
import type { RenderedElement } from "./backend";
import { SpeechManager } from "./speech";

export type PlaybackMode = "narrated" | "silent" | "instant";
export type PlayerState = "idle" | "playing" | "paused" | "done";

export interface PlayerCallbacks {
  onState?(state: PlayerState): void;
  onStep?(completed: number, total: number): void;
}

export class Player {
  private plan: Plan;
  private elements: Map<string, RenderedElement>;
  private speech: SpeechManager;
  private captionEl: HTMLElement | null;
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
    opts: { mode?: PlaybackMode; speed?: number } = {},
    callbacks: PlayerCallbacks = {},
  ) {
    this.plan = plan;
    this.elements = elements;
    this.speech = speech;
    this.captionEl = captionEl;
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

  /** Jump to a step boundary: exactly the elements drawn by steps[0..n-1] are visible. */
  renderUpTo(n: number): void {
    this.abortRun();
    const drawn = new Set(n > 0 ? this.plan.drawnUpTo[n - 1] : []);
    for (const [id, el] of this.elements) {
      if (drawn.has(id)) el.finish();
      else el.hide();
    }
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

  private async runStep(index: number, signal: AbortSignal): Promise<void> {
    const step = this.plan.steps[index];
    if (step.kind === "speak") {
      this.setCaption(step.text);
      if (this.mode === "narrated") {
        await this.speech.speak(step.text, this.speedVal, signal);
      } else {
        // silent: caption still shown briefly
        await this.waitScaled(Math.min(1400, SpeechManager.estimateMs(step.text) * 0.4), signal);
      }
      return;
    }
    if (step.kind === "pause") {
      await this.waitScaled(step.seconds * 1000, signal);
      return;
    }
    const els = step.ids
      .map((id) => this.elements.get(id))
      .filter((el): el is RenderedElement => el !== undefined);
    if (step.parallel) {
      await Promise.all(els.map((el) => this.animate(el, signal)));
    } else {
      for (const el of els) {
        await this.animate(el, signal);
        if (signal.aborted) return;
      }
    }
  }

  private animate(el: RenderedElement, signal: AbortSignal): Promise<void> {
    if (el.durationMs <= 0) {
      el.finish();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let t = 0;
      let last = performance.now();
      const tick = (now: number) => {
        if (signal.aborted) return resolve();
        if (!this.pausedFlag) t += (now - last) * this.speedVal;
        last = now;
        const p = Math.min(t / el.durationMs, 1);
        el.setProgress(p);
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
