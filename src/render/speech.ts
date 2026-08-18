// Web Speech wrapper. Utterance-granularity sync via onend; graceful fallback
// to a reading-time estimate when speech is unavailable or errors. Voices load
// asynchronously (voiceschanged).

export class SpeechManager {
  private synth: SpeechSynthesis | null;
  private voiceURI: string | null = null;
  private rate = 1;
  private listeners: (() => void)[] = [];

  constructor() {
    this.synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
    this.synth?.addEventListener?.("voiceschanged", () => {
      this.listeners.forEach((cb) => cb());
    });
  }

  get available(): boolean {
    return this.synth !== null;
  }

  voices(): SpeechSynthesisVoice[] {
    return this.synth?.getVoices() ?? [];
  }

  onVoicesChanged(cb: () => void): void {
    this.listeners.push(cb);
  }

  setVoice(uri: string | null): void {
    this.voiceURI = uri;
  }

  setRate(rate: number): void {
    this.rate = rate;
  }

  /** Reading-time estimate (~170 wpm), used for captions when speech can't run. */
  static estimateMs(text: string): number {
    const words = text.trim().split(/\s+/).length;
    return Math.min(15000, Math.max(900, (words / 170) * 60000));
  }

  cancel(): void {
    this.synth?.cancel();
  }

  /**
   * Speak one utterance; resolves when it ends. speedMultiplier scales the
   * configured rate. Falls back to a timed wait on error/unavailability.
   */
  speak(text: string, speedMultiplier: number, signal?: AbortSignal): Promise<void> {
    const estimate = SpeechManager.estimateMs(text) / speedMultiplier;
    if (!this.synth || signal?.aborted) {
      return abortableWait(estimate, signal);
    }
    const synth = this.synth;
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        synth.cancel();
        done();
      };
      signal?.addEventListener("abort", onAbort);

      const utterance = new SpeechSynthesisUtterance(text);
      const voice = this.voices().find((v) => v.voiceURI === this.voiceURI);
      if (voice) utterance.voice = voice;
      utterance.rate = Math.min(4, Math.max(0.25, this.rate * speedMultiplier));
      utterance.onend = done;
      utterance.onerror = () => {
        // fall back to the remaining reading-time estimate
        setTimeout(done, estimate);
      };
      // Watchdog: some browsers silently never start; fall back after a grace period.
      let watchdog = setTimeout(() => {
        if (!synth.speaking && !synth.pending) {
          setTimeout(done, estimate);
        } else {
          watchdog = setTimeout(() => done(), estimate * 2.5);
        }
      }, 2500);

      try {
        synth.speak(utterance);
      } catch {
        setTimeout(done, estimate);
      }
    });
  }
}

export function abortableWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => resolve(), ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}
