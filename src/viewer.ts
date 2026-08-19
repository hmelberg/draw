// Standalone viewer mode: #gdoc=<google-doc-id> loads a spec from a
// link-shared Google Doc and shows just a single player — no harness, no AI,
// no key. Extra hash params: &backend=clean-svg &mode=silent &speed=1.5.
// Example: https://draw.melberg.app/#gdoc=1AbC…xyz

import "./styles.css";
import { render } from "./render";
import { SpeechManager } from "./render/speech";
import { attachPlayerControls, h } from "./harness/cards";
import { desmartenJson, extractJson } from "./spec/extract";
import { validateSpec } from "./spec/schema";
import type { Spec } from "./spec/types";
import { loadSettings } from "./harness/store";

export interface ViewerRequest {
  docId: string;
  backend: string;
  mode: "narrated" | "silent" | "instant";
  speed: number;
}

/** Accepts #gdoc=<id> and #gdoc-<id>, with optional &backend= &mode= &speed=. */
export function parseViewerHash(hash: string): ViewerRequest | null {
  const m = /[#&]gdoc[=-]([A-Za-z0-9_-]{10,})/.exec(hash);
  if (!m) return null;
  const params = new URLSearchParams(hash.replace(/^#/, "").replace(/gdoc-([A-Za-z0-9_-]+)/, "gdoc=$1"));
  const mode = params.get("mode");
  return {
    docId: m[1],
    backend: params.get("backend") ?? "custom-svg",
    mode: mode === "silent" || mode === "instant" ? mode : "narrated",
    speed: parseFloat(params.get("speed") ?? "") || loadSettings().speed || 1,
  };
}

/** Fetch the doc text via the public export endpoints (doc must be link-shared). */
async function fetchGdocText(docId: string): Promise<string> {
  const urls = [
    `https://docs.google.com/document/d/${docId}/export?format=txt`,
    `https://docs.google.com/feeds/download/documents/export/Export?id=${docId}&exportFormat=txt`,
  ];
  let lastError = "";
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.text();
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  throw new Error(
    `Could not fetch the Google Doc (${lastError}). Make sure sharing is set to "Anyone with the link can view" (Share → General access).`,
  );
}

export async function runViewer(req: ViewerRequest): Promise<void> {
  document.body.classList.add("viewer-body");
  const app = document.getElementById("app")!;
  const titleEl = h("h1", { class: "viewer-title squiggle" }, "Concept Sketch");
  const status = h("div", { class: "viewer-status" }, "Loading drawing from Google Doc…");
  const figureHost = h("div", { class: "viewer-figure" });
  const footer = h(
    "div",
    { class: "viewer-footer" },
    h("a", { href: location.pathname, title: "Open the Concept Sketch app" }, "Made with Concept Sketch ✏️"),
  );
  app.append(h("div", { class: "viewer-wrap" }, titleEl, status, figureHost, footer));

  try {
    const text = await fetchGdocText(req.docId);
    const spec = extractJson(desmartenJson(text)) as Spec;
    const validation = validateSpec(spec);
    if (!validation.ok) {
      throw new Error(`The document's spec is invalid: ${validation.errors[0]}${validation.errors.length > 1 ? ` (+${validation.errors.length - 1} more)` : ""}`);
    }
    if (spec.title) {
      titleEl.textContent = spec.title;
      document.title = `${spec.title} — Concept Sketch`;
    }
    const settings = loadSettings();
    const speech = new SpeechManager();
    speech.setVoice(settings.voiceURI);
    speech.setRate(settings.rate);
    const handle = await render(spec, figureHost, {
      backend: req.backend,
      mode: req.mode,
      speed: req.speed,
      speech,
    });
    attachPlayerControls(figureHost, handle, { mode: req.mode, speed: req.speed });
    status.remove();
  } catch (err) {
    status.textContent = (err as Error).message;
    status.classList.add("error");
  }
}
