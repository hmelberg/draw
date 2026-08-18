// Web Speech wrapper. Utterance-granularity sync via onend; graceful fallback
// to a reading-time estimate when speech is unavailable or errors. Voices load
// asynchronously (voiceschanged).
//
// Browsers default to poor voices (Firefox/macOS famously lands on a metallic
// one). Unless the user picked a voice explicitly, we score the available
// voices and choose the best match for the utterance's language.

const PREFERRED_NAMES = [
  "Samantha", "Ava", "Allison", "Susan", "Zoe", "Evan", "Nathan", "Joelle", "Aaron",
  "Karen", "Daniel", "Serena", "Moira", "Tessa", "Fiona", "Kate", "Oliver",
  "Nora", "Henrik", // Norwegian system voices
];

// Novelty and legacy voices that sound robotic — never auto-pick these.
const AVOID_NAMES =
  /fred|albert|zarvox|trinoids|whisper|wobble|deranged|hysterical|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|good news|bahh|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|compact|espeak|eloquence/i;

function scoreVoice(v: SpeechSynthesisVoice, lang: "en" | "nb"): number {
  const vLang = v.lang.toLowerCase();
  const langFamily = lang === "nb" ? ["nb", "no", "nn"] : ["en"];
  if (!langFamily.some((l) => vLang.startsWith(l))) return -1;
  let s = 10;
  if (AVOID_NAMES.test(v.name)) return 0; // last resort only
  if (/enhanced|premium|natural|neural|siri/i.test(v.name)) s += 40;
  if (PREFERRED_NAMES.some((n) => v.name.startsWith(n))) s += 25;
  if (/google|microsoft/i.test(v.name)) s += 15;
  if (lang === "en" && vLang.startsWith("en-us")) s += 4;
  if (lang === "nb" && (vLang.startsWith("nb") || vLang.startsWith("no"))) s += 4;
  return s;
}

/** Cheap utterance-language sniff: Norwegian characters or function words. */
export function detectLang(text: string): "en" | "nb" {
  if (/[æøå]/i.test(text)) return "nb";
  const norwegianWords = /\b(og|er|ikke|det|som|en|et|på|til|av|vi|når|hvor|med|for at)\b/i;
  const hits = (text.toLowerCase().match(norwegianWords) ?? []).length;
  return hits >= 1 && !/\b(the|and|is|of|with|as)\b/i.test(text) ? "nb" : "en";
}

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

  /** Highest-scoring voice for a language; null lets the browser default. */
  bestVoice(lang: "en" | "nb"): SpeechSynthesisVoice | null {
    let best: SpeechSynthesisVoice | null = null;
    let bestScore = 0;
    for (const v of this.voices()) {
      const s = scoreVoice(v, lang);
      if (s > bestScore) {
        best = v;
        bestScore = s;
      }
    }
    return best;
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
      const lang = detectLang(text);
      const explicit = this.voices().find((v) => v.voiceURI === this.voiceURI);
      const voice = explicit ?? this.bestVoice(lang);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? (lang === "nb" ? "nb-NO" : "en-US");
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
