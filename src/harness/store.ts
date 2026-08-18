// Local persistence for the experiment: settings, API key, generation logs,
// exemplar library. Everything exportable as JSON (Loops 2 & 3 feed on this).

import { SPEC_VERSION } from "../spec/schema";
import type { Spec } from "../spec/types";
import type { LintIssue } from "../lint/lint";

const KEYS = {
  settings: "draw.settings.v1",
  logs: "draw.logs.v1",
  exemplars: "draw.exemplars.v1",
  apiKey: "draw.apikey",
} as const;

export interface Settings {
  model: string;
  backend: string;
  variant: string;
  mode: "narrated" | "silent" | "instant";
  speed: number;
  voiceURI: string | null;
  rate: number;
  compareBackends: string[];
  compareVariants: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  model: "claude-opus-5",
  backend: "custom-svg",
  variant: "v1",
  mode: "narrated",
  speed: 1,
  voiceURI: null,
  rate: 1,
  compareBackends: ["custom-svg", "raw-svg-baseline"],
  compareVariants: ["v1"],
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function readArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function loadSettings(): Settings {
  return read(KEYS.settings, DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.settings, JSON.stringify(s));
}

export function getApiKey(): string {
  return localStorage.getItem(KEYS.apiKey) ?? "";
}

export function setApiKey(key: string): void {
  if (key) localStorage.setItem(KEYS.apiKey, key);
  else localStorage.removeItem(KEYS.apiKey);
}

// ---- Generation log (Loop 3's raw material) ----

export interface LogRound {
  label: string;
  validationErrors: string[];
  lintCount: number;
  ms: number;
  structuredOutput?: boolean;
}

export interface LogEntry {
  id: string;
  ts: string;
  prompt: string;
  config: {
    model: string;
    backend: string;
    promptVariant: string;
    specVersion: string;
  };
  family?: string;
  rounds: LogRound[];
  spec: Spec | null;
  lintIssues: Pick<LintIssue, "rule" | "ids" | "message" | "severity">[];
  warnings: string[];
  renderMs?: number;
  error?: string;
  rating?: number;
  tags?: string[];
  comment?: string;
  baselineSvg?: string;
}

const MAX_LOGS = 300;

export function loadLogs(): LogEntry[] {
  return readArray<LogEntry>(KEYS.logs);
}

export function appendLog(entry: LogEntry): void {
  const logs = loadLogs();
  if (entry.baselineSvg && entry.baselineSvg.length > 50_000) {
    entry.baselineSvg = entry.baselineSvg.slice(0, 50_000);
  }
  logs.push(entry);
  while (logs.length > MAX_LOGS) logs.shift();
  try {
    localStorage.setItem(KEYS.logs, JSON.stringify(logs));
  } catch {
    // quota: drop oldest half and retry once
    localStorage.setItem(KEYS.logs, JSON.stringify(logs.slice(Math.floor(logs.length / 2))));
  }
}

export function updateLog(id: string, patch: Partial<LogEntry>): void {
  const logs = loadLogs();
  const idx = logs.findIndex((l) => l.id === id);
  if (idx === -1) return;
  logs[idx] = { ...logs[idx], ...patch };
  localStorage.setItem(KEYS.logs, JSON.stringify(logs));
}

export function clearLogs(): void {
  localStorage.removeItem(KEYS.logs);
}

// ---- Exemplar library (Loop 2) ----

export interface StoredExemplar {
  prompt: string;
  spec: Spec;
  rating?: number;
  ts: string;
}

export function loadExemplars(): StoredExemplar[] {
  return readArray<StoredExemplar>(KEYS.exemplars);
}

export function addExemplar(ex: StoredExemplar): void {
  const all = loadExemplars();
  all.push(ex);
  localStorage.setItem(KEYS.exemplars, JSON.stringify(all));
}

// ---- Exports ----

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const FAILURE_TAGS = [
  "overlap",
  "bad-label-placement",
  "wrong-shape",
  "wrong-concept",
  "ugly-style",
  "animation-issue",
  "other",
] as const;

/** Loop 3 handoff: the exportable improvement packet for a Claude Code session. */
export function buildImprovementPacket(): object {
  const logs = loadLogs();
  const byFamily: Record<string, { count: number; ratings: number[]; tags: Record<string, number>; lintRules: Record<string, number> }> = {};
  const untemplatedPrompts: string[] = [];

  for (const log of logs) {
    const family = log.family ?? (log.spec?.template ? `template:${log.spec.template}` : "untemplated");
    byFamily[family] ??= { count: 0, ratings: [], tags: {}, lintRules: {} };
    const f = byFamily[family];
    f.count++;
    if (log.rating !== undefined) f.ratings.push(log.rating);
    for (const t of log.tags ?? []) f.tags[t] = (f.tags[t] ?? 0) + 1;
    for (const i of log.lintIssues) f.lintRules[i.rule] = (f.lintRules[i.rule] ?? 0) + 1;
    if (!log.spec?.template && log.spec) untemplatedPrompts.push(log.prompt);
  }

  const worst = [...logs]
    .filter((l) => l.rating !== undefined || l.tags?.length || l.error)
    .sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0) || b.lintIssues.length - a.lintIssues.length)
    .slice(0, 10)
    .map((l) => ({
      prompt: l.prompt,
      config: l.config,
      spec: l.spec,
      lint: l.lintIssues,
      warnings: l.warnings,
      rounds: l.rounds,
      rating: l.rating,
      tags: l.tags,
      comment: l.comment,
      error: l.error,
    }));

  return {
    generated_at: new Date().toISOString(),
    app: "draw (Concept Sketch)",
    spec_version: SPEC_VERSION,
    stats: {
      total_logged: logs.length,
      by_family: Object.fromEntries(
        Object.entries(byFamily).map(([k, v]) => [
          k,
          {
            count: v.count,
            avg_rating: v.ratings.length ? v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length : null,
            tag_counts: v.tags,
            lint_rule_counts: v.lintRules,
          },
        ]),
      ),
      untemplated_prompts: untemplatedPrompts,
    },
    worst_cases: worst,
    handoff_instructions:
      "This packet was exported by the Concept Sketch harness (repo: draw). " +
      "Feed it to a Claude Code session in that repo. Renderer/layout code lives in src/layout and src/scenes; " +
      "scene manifests (routing data) in src/scenes/*/manifest.json; the compiler prompt in src/llm/prompts/. " +
      "Untemplated prompt clusters above suggest which scene to author next. " +
      "PNG screenshots and pre-drafted scene skeletons are not included yet (see ROADMAP).",
  };
}
