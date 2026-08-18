// The experiment harness UI: prompt → generate → compare configurations
// side by side, rate results, run the benchmark, export logs and packets.

import "./styles.css";
import { render, type RenderHandle } from "./render";
import { SpeechManager } from "./render/speech";
import { backendRegistry, RAW_BASELINE_NAME } from "./render/backends";
import { generateSpec, promptVariants, type GenerationOutcome, type PromptVariant } from "./llm/compile";
import { generateRawSvg } from "./llm/baseline";
import { describeApiError, MODELS } from "./llm/client";
import { validateSpec } from "./spec/schema";
import { SPEC_VERSION } from "./spec/schema";
import type { Spec } from "./spec/types";
import { BENCHMARK } from "./harness/benchmark";
import { createCard, h, type Card } from "./harness/cards";
import {
  addExemplar,
  appendLog,
  buildImprovementPacket,
  clearLogs,
  downloadJson,
  getApiKey,
  loadExemplars,
  loadLogs,
  loadSettings,
  saveSettings,
  setApiKey,
  updateLog,
  type LogEntry,
} from "./harness/store";
import fewshots from "./llm/prompts/fewshots.json";

const settings = loadSettings();
const speech = new SpeechManager();
speech.setVoice(settings.voiceURI);
speech.setRate(settings.rate);
const variants: PromptVariant[] = promptVariants();

const app = document.getElementById("app")!;

// ---------- page skeleton ----------

const promptEl = h("textarea", {
  id: "prompt",
  "aria-label": "Describe the drawing",
  placeholder: "Describe the drawing… e.g. \"Show the deadweight loss from a tax, with shaded regions\"",
});
const generateBtn = h("button", { class: "primary" }, "Generate");
const compareBtn = h("button", {}, "Compare configs");
const exampleBtn = h("button", { title: "Render a bundled spec without an API key" }, "Offline example");
const settingsBtn = h("button", {}, "Settings ⚙");

const modelSel = h("select", { title: "Model" });
for (const m of MODELS) modelSel.appendChild(h("option", { value: m.id }, m.label));
modelSel.value = settings.model;

const backendSel = h("select", { title: "Backend" });
for (const b of Object.values(backendRegistry)) backendSel.appendChild(h("option", { value: b.name }, b.label));
backendSel.appendChild(h("option", { value: RAW_BASELINE_NAME }, "Raw-SVG baseline (backend 0)"));
backendSel.value = settings.backend;

const variantSel = h("select", { title: "Prompt variant" });
for (const v of variants) variantSel.appendChild(h("option", { value: v.name }, `prompt ${v.name}`));
if (variants.some((v) => v.name === settings.variant)) variantSel.value = settings.variant;

const compareWrap = h("details", {});
compareWrap.appendChild(h("summary", {}, "Compare set (backend × prompt variant)"));
const compareBackendBoxes: HTMLInputElement[] = [];
const compareVariantBoxes: HTMLInputElement[] = [];
{
  const row1 = h("div", { class: "tags" });
  for (const name of [...Object.keys(backendRegistry), RAW_BASELINE_NAME]) {
    const cb = h("input", { type: "checkbox", value: name }) as HTMLInputElement;
    cb.checked = settings.compareBackends.includes(name);
    cb.addEventListener("change", persistCompareSet);
    compareBackendBoxes.push(cb);
    row1.appendChild(h("label", {}, cb, ` ${name}`));
  }
  const row2 = h("div", { class: "tags" });
  for (const v of variants) {
    const cb = h("input", { type: "checkbox", value: v.name }) as HTMLInputElement;
    cb.checked = settings.compareVariants.includes(v.name);
    cb.addEventListener("change", persistCompareSet);
    compareVariantBoxes.push(cb);
    row2.appendChild(h("label", {}, cb, ` prompt ${v.name}`));
  }
  compareWrap.append(h("div", { class: "hint" }, "Backends:"), row1, h("div", { class: "hint" }, "Prompt variants:"), row2);
}

const resultsEl = h("div", { class: "results" });

const benchStatus = h("span", { class: "hint" });
const benchRunBtn = h("button", {}, "Run benchmark");
const benchList = h("ol", { class: "bench-list" });
for (const b of BENCHMARK) {
  const link = h(
    "button",
    { class: "bench-link", title: "Generate just this prompt with the current model/backend/prompt variant" },
    b.prompt,
  );
  link.addEventListener("click", () => {
    promptEl.value = b.prompt;
    window.scrollTo({ top: 0, behavior: "smooth" });
    void runConfigs(b.prompt, [settings.backend], [settings.variant], b.family);
  });
  benchList.appendChild(
    h("li", {}, link, h("span", { class: "family" }, `${b.family}${b.curveball ? " · curveball" : ""}`)),
  );
}

const logCount = h("span", { class: "count" });
const exemplarCount = h("span", { class: "count" });
const exportLogsBtn = h("button", { class: "small" }, "Export logs JSON");
const exportPacketBtn = h("button", { class: "small", title: "Loop 3: worst cases + failure stats for a Claude Code session" }, "Export improvement packet");
const clearLogsBtn = h("button", { class: "small" }, "Clear logs");

app.append(
  h(
    "header",
    { class: "topbar" },
    h("div", { class: "wordmark squiggle" }, "Concept Sketch", h("span", { class: "tagline" }, "LLM → drawing-spec experiment harness")),
    settingsBtn,
  ),
  h(
    "main",
    {},
    h(
      "section",
      { class: "panel composer" },
      promptEl,
      h("div", { class: "composer-actions" }, generateBtn, compareBtn, exampleBtn),
      h(
        "div",
        { class: "config-row" },
        h("label", {}, "Model", modelSel),
        h("label", {}, "Backend", backendSel),
        h("label", {}, "Prompt", variantSel),
      ),
      compareWrap,
    ),
    resultsEl,
    h(
      "section",
      { class: "panel bench" },
      h("h2", { class: "squiggle" }, "Benchmark"),
      h("div", {}, benchRunBtn, " ", benchStatus),
      benchList,
      h("div", { class: "hint" }, "Runs all 10 prompts with the selected model/backend/prompt variant, sequentially, and logs every result. Vision critic (Loop 1.3) is not built yet — see ROADMAP."),
    ),
    h(
      "section",
      { class: "panel data" },
      h("h2", { class: "squiggle" }, "Experiment data"),
      h("div", { class: "data-row" }, logCount, exemplarCount, exportLogsBtn, exportPacketBtn, clearLogsBtn),
    ),
  ),
);

// ---------- settings dialog ----------

const keyInput = h("input", { id: "apikey", type: "password", placeholder: "sk-ant-…", autocomplete: "off" }) as HTMLInputElement;
keyInput.value = getApiKey();
const clearKeyBtn = h("button", { class: "small" }, "Clear key");
const voiceSel = h("select", { id: "voice" });
const rateSel = h("select", { id: "voice-rate" });
for (const r of ["0.8", "0.9", "1", "1.1", "1.25"]) rateSel.appendChild(h("option", { value: r }, `${r}×`));
rateSel.value = String(settings.rate);

const dialog = h(
  "dialog",
  {},
  h("h3", {}, "Settings"),
  h(
    "div",
    { class: "settings-field" },
    h("label", { for: "apikey" }, "Anthropic API key (bring your own)"),
    keyInput,
    h("div", {}, clearKeyBtn),
    h(
      "div",
      { class: "settings-note" },
      "Stored in this browser's localStorage only. It never leaves the browser except in requests to api.anthropic.com.",
    ),
  ),
  h("div", { class: "settings-field" }, h("label", { for: "voice" }, "Narration voice"), voiceSel),
  h("div", { class: "settings-field" }, h("label", { for: "voice-rate" }, "Narration rate"), rateSel),
  h("div", {}, h("button", { class: "primary small" }, "Close")),
);
app.appendChild(dialog);
dialog.querySelector("button.primary")!.addEventListener("click", () => dialog.close());

function populateVoices(): void {
  const voices = speech.voices();
  voiceSel.replaceChildren(h("option", { value: "" }, "(browser default)"));
  const score = (v: SpeechSynthesisVoice) => (v.lang.startsWith("no") || v.lang.startsWith("nb") || v.lang.startsWith("nn") ? 0 : v.lang.startsWith("en") ? 1 : 2);
  for (const v of [...voices].sort((a, b) => score(a) - score(b) || a.lang.localeCompare(b.lang))) {
    const o = h("option", { value: v.voiceURI }, `${v.name} (${v.lang})`);
    voiceSel.appendChild(o);
  }
  if (settings.voiceURI) voiceSel.value = settings.voiceURI;
}
populateVoices();
speech.onVoicesChanged(populateVoices);

// ---------- event wiring ----------

function persist(): void {
  saveSettings(settings);
}

function persistCompareSet(): void {
  settings.compareBackends = compareBackendBoxes.filter((c) => c.checked).map((c) => c.value);
  settings.compareVariants = compareVariantBoxes.filter((c) => c.checked).map((c) => c.value);
  persist();
}

settingsBtn.addEventListener("click", () => dialog.showModal());
keyInput.addEventListener("change", () => setApiKey(keyInput.value.trim()));
clearKeyBtn.addEventListener("click", () => {
  setApiKey("");
  keyInput.value = "";
});
voiceSel.addEventListener("change", () => {
  settings.voiceURI = voiceSel.value || null;
  speech.setVoice(settings.voiceURI);
  persist();
});
rateSel.addEventListener("change", () => {
  settings.rate = parseFloat(rateSel.value);
  speech.setRate(settings.rate);
  persist();
});
modelSel.addEventListener("change", () => {
  settings.model = modelSel.value;
  persist();
});
backendSel.addEventListener("change", () => {
  settings.backend = backendSel.value;
  persist();
});
variantSel.addEventListener("change", () => {
  settings.variant = variantSel.value;
  persist();
});

generateBtn.addEventListener("click", () => void generate());
compareBtn.addEventListener("click", () => void compare());
exampleBtn.addEventListener("click", () => void offlineExample());
benchRunBtn.addEventListener("click", () => void runBenchmark());
exportLogsBtn.addEventListener("click", () => downloadJson(`draw-logs-${Date.now()}.json`, loadLogs()));
exportPacketBtn.addEventListener("click", () => downloadJson(`draw-improvement-packet-${Date.now()}.json`, buildImprovementPacket()));
clearLogsBtn.addEventListener("click", () => {
  clearLogs();
  refreshCounts();
});

function refreshCounts(): void {
  logCount.textContent = `${loadLogs().length} logged generations`;
  exemplarCount.textContent = `${loadExemplars().length} exemplars`;
}
refreshCounts();

// ---------- generation flows ----------

function requireKey(): string | null {
  const key = getApiKey();
  if (!key) {
    dialog.showModal();
    return null;
  }
  return key;
}

function variantByName(name: string): PromptVariant {
  return variants.find((v) => v.name === name) ?? variants[0];
}

async function generate(): Promise<void> {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  await runConfigs(prompt, [settings.backend], [settings.variant]);
}

async function compare(): Promise<void> {
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  const backends = settings.compareBackends.length > 0 ? settings.compareBackends : [settings.backend];
  const variantNames = settings.compareVariants.length > 0 ? settings.compareVariants : [settings.variant];
  await runConfigs(prompt, backends, variantNames);
}

async function runConfigs(prompt: string, backends: string[], variantNames: string[], family?: string): Promise<void> {
  const apiKey = requireKey();
  if (!apiKey) return;

  for (const variantName of variantNames) {
    const specBackends = backends.filter((b) => b !== RAW_BASELINE_NAME);
    if (specBackends.length > 0) {
      const cards = specBackends.map((b) => newSpecCard(prompt, b, variantName));
      cards.forEach((c) => c.card.setStatus(`Generating spec (${settings.model}, prompt ${variantName})…`));
      const outcome = await generateSpec(prompt, {
        apiKey,
        model: settings.model,
        variant: variantByName(variantName),
        exemplars: loadExemplars(),
      });
      for (const c of cards) {
        await fillSpecCard(c, prompt, outcome, variantName, family);
      }
    }
    if (backends.includes(RAW_BASELINE_NAME)) {
      await runBaseline(prompt, apiKey, family);
    }
  }
  refreshCounts();
}

interface SpecCardCtx {
  card: Card;
  backendName: string;
  logId: string;
  current: { handle: RenderHandle | null };
}

function playbackPrefs() {
  return {
    mode: settings.mode,
    speed: settings.speed,
    onMode: (m: typeof settings.mode) => {
      settings.mode = m;
      persist();
    },
    onSpeed: (s: number) => {
      settings.speed = s;
      persist();
    },
  };
}

function newSpecCard(prompt: string, backendName: string, variantName: string): SpecCardCtx {
  const logId = crypto.randomUUID();
  const current: { handle: RenderHandle | null } = { handle: null };
  let lastSpec: Spec | null = null;

  const card = createCard(truncate(prompt, 64), `${backendName} · ${settings.model} · prompt ${variantName}`, {
    onRating: (rating) => updateLog(logId, { rating }),
    onTags: (tags, comment) => updateLog(logId, { tags, comment }),
    onPromote: () => {
      if (lastSpec) {
        addExemplar({ prompt, spec: lastSpec, ts: new Date().toISOString() });
        refreshCounts();
      }
    },
    onRerender: (specText) => void rerender(specText),
  }, playbackPrefs());
  resultsEl.prepend(card.root);

  async function rerender(specText: string): Promise<void> {
    let spec: unknown;
    try {
      spec = JSON.parse(specText);
    } catch (err) {
      card.setStatus(`Spec is not valid JSON: ${(err as Error).message}`, "error");
      return;
    }
    const v = validateSpec(spec);
    if (!v.ok) {
      card.setStatus(`Spec invalid: ${v.errors[0]}${v.errors.length > 1 ? ` (+${v.errors.length - 1} more)` : ""}`, "error");
      return;
    }
    current.handle?.destroy();
    card.stageHost.replaceChildren();
    lastSpec = spec as Spec;
    const handle = await render(lastSpec, card.stageHost, { backend: backendName, speech, mode: settings.mode, speed: settings.speed });
    current.handle = handle;
    card.attachHandle(handle);
    card.setLint(handle.layout.issues, handle.layout.warnings);
    card.setStatus("Re-rendered from edited spec.", "ok");
  }

  const ctx: SpecCardCtx = { card, backendName, logId, current };
  // expose lastSpec setter through closure
  (ctx as SpecCardCtx & { setLastSpec: (s: Spec) => void }).setLastSpec = (s: Spec) => {
    lastSpec = s;
  };
  return ctx;
}

async function fillSpecCard(ctx: SpecCardCtx, prompt: string, outcome: GenerationOutcome, variantName: string, family?: string): Promise<void> {
  const { card, backendName, logId } = ctx;
  const entry: LogEntry = {
    id: logId,
    ts: new Date().toISOString(),
    prompt,
    config: { model: settings.model, backend: backendName, promptVariant: variantName, specVersion: SPEC_VERSION },
    family,
    rounds: outcome.rounds.map((r) => ({
      label: r.label,
      validationErrors: r.validationErrors,
      lintCount: r.lintIssues.length,
      ms: Math.round(r.meta.ms),
      structuredOutput: r.meta.structuredOutput,
    })),
    spec: outcome.spec,
    lintIssues: [],
    warnings: [],
    error: outcome.error,
  };

  if (!outcome.spec) {
    card.setStatus(outcome.error ?? "Generation failed.", "error");
    appendLog(entry);
    return;
  }

  (ctx as SpecCardCtx & { setLastSpec?: (s: Spec) => void }).setLastSpec?.(outcome.spec);
  if (outcome.spec.title) card.setTitle(outcome.spec.title);
  card.setSpecText(outcome.spec);
  card.setStatus(outcome.error ? `Partial: ${outcome.error}` : "Rendering…", outcome.error ? "error" : "info");

  const t0 = performance.now();
  try {
    const handle = await render(outcome.spec, card.stageHost, { backend: backendName, speech, mode: settings.mode, speed: settings.speed });
    ctx.current.handle = handle;
    card.attachHandle(handle);
    card.setLint(handle.layout.issues, handle.layout.warnings);
    entry.lintIssues = handle.layout.issues.map(({ rule, ids, message, severity }) => ({ rule, ids, message, severity }));
    entry.warnings = handle.layout.warnings;
    entry.renderMs = Math.round(performance.now() - t0);
    const meta = [
      `${outcome.rounds.length} round${outcome.rounds.length === 1 ? "" : "s"}`,
      `${entry.rounds.reduce((a, r) => a + r.ms, 0)} ms LLM`,
      `${entry.renderMs} ms render`,
      outcome.rounds[0]?.meta.structuredOutput ? "structured output" : "plain JSON",
      outcome.rounds[0]?.meta.servedBy ? `served by ${outcome.rounds[0].meta.servedBy}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    card.setMetaLine(meta);
    card.setStatus(handle.backendApplies ? "Ready." : "Backend does not support this family.", handle.backendApplies ? "ok" : "error");
  } catch (err) {
    card.setStatus(`Render failed: ${(err as Error).message}`, "error");
    entry.error = `render: ${(err as Error).message}`;
  }
  appendLog(entry);
}

async function runBaseline(prompt: string, apiKey: string, family?: string): Promise<void> {
  const logId = crypto.randomUUID();
  const card = createCard(truncate(prompt, 64), `raw-svg-baseline · ${settings.model}`, {
    onRating: (rating) => updateLog(logId, { rating }),
    onTags: (tags, comment) => updateLog(logId, { tags, comment }),
  });
  resultsEl.prepend(card.root);
  card.setStatus(`Generating raw SVG (${settings.model})…`);
  try {
    const { svg, ms } = await generateRawSvg(prompt, { apiKey, model: settings.model });
    card.showRawSvg(svg);
    card.setMetaLine(`${Math.round(ms)} ms LLM · no spec · no lint`);
    card.setStatus("Baseline rendered.", "ok");
    appendLog({
      id: logId,
      ts: new Date().toISOString(),
      prompt,
      config: { model: settings.model, backend: RAW_BASELINE_NAME, promptVariant: "-", specVersion: SPEC_VERSION },
      family,
      rounds: [{ label: "initial", validationErrors: [], lintCount: 0, ms: Math.round(ms) }],
      spec: null,
      lintIssues: [],
      warnings: [],
      baselineSvg: svg,
    });
  } catch (err) {
    card.setStatus(describeApiError(err), "error");
    appendLog({
      id: logId,
      ts: new Date().toISOString(),
      prompt,
      config: { model: settings.model, backend: RAW_BASELINE_NAME, promptVariant: "-", specVersion: SPEC_VERSION },
      family,
      rounds: [],
      spec: null,
      lintIssues: [],
      warnings: [],
      error: describeApiError(err),
    });
  }
}

let exampleIdx = 0;
async function offlineExample(): Promise<void> {
  const examples = fewshots as { request: string; spec: Spec }[];
  const ex = examples[exampleIdx % examples.length];
  exampleIdx++;
  const ctx = newSpecCard(ex.request, settings.backend === RAW_BASELINE_NAME ? "custom-svg" : settings.backend, "bundled");
  if (ex.spec.title) ctx.card.setTitle(ex.spec.title);
  ctx.card.setSpecText(ex.spec);
  const handle = await render(ex.spec, ctx.card.stageHost, { backend: ctx.backendName, speech, mode: settings.mode, speed: settings.speed });
  ctx.current.handle = handle;
  ctx.card.attachHandle(handle);
  ctx.card.setLint(handle.layout.issues, handle.layout.warnings);
  ctx.card.setMetaLine("bundled example spec — no API call");
  ctx.card.setStatus("Ready.", "ok");
}

async function runBenchmark(): Promise<void> {
  const apiKey = requireKey();
  if (!apiKey) return;
  benchRunBtn.disabled = true;
  try {
    for (const [i, b] of BENCHMARK.entries()) {
      benchStatus.textContent = `Running ${i + 1}/${BENCHMARK.length}: ${b.prompt}`;
      await runConfigs(b.prompt, [settings.backend], [settings.variant], b.family);
    }
    benchStatus.textContent = `Done — ${BENCHMARK.length} prompts logged.`;
  } finally {
    benchRunBtn.disabled = false;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
