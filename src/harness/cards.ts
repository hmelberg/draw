// Result cards: one per (prompt × configuration). Playback controls, editable
// spec panel, lint report, rating/tag/promote — the human-input surface.

import type { RenderHandle } from "../render";
import type { LintIssue } from "../lint/lint";
import { FAILURE_TAGS } from "./store";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

export interface CardHooks {
  onRating?(rating: number): void;
  onTags?(tags: string[], comment: string): void;
  onPromote?(): void;
  onRerender?(specText: string): void;
}

export interface Card {
  root: HTMLElement;
  stageHost: HTMLElement;
  setStatus(text: string, kind?: "info" | "error" | "ok"): void;
  attachHandle(handle: RenderHandle): void;
  showRawSvg(svg: string): void;
  setSpecText(spec: unknown): void;
  setLint(issues: LintIssue[], warnings: string[]): void;
  setMetaLine(text: string): void;
  destroy(): void;
}

export function createCard(title: string, subtitle: string, hooks: CardHooks = {}): Card {
  const status = h("div", { class: "card-status" });
  const stageHost = h("div", { class: "card-stage-host" });
  const controls = h("div", { class: "card-controls" });
  const lintBox = h("div", {});
  const metaLine = h("div", { class: "meta-line" });
  const specArea = h("textarea", { spellcheck: "false" });
  const rerenderBtn = h("button", { class: "small" }, "Re-render");
  rerenderBtn.addEventListener("click", () => hooks.onRerender?.(specArea.value));

  const ratingBox = h("span", { class: "rating" });
  const ratingButtons: HTMLButtonElement[] = [];
  for (let n = 1; n <= 5; n++) {
    const b = h("button", { title: `${n}/5 — would use in teaching` }, "★");
    b.addEventListener("click", () => {
      ratingButtons.forEach((rb, i) => rb.classList.toggle("lit", i < n));
      hooks.onRating?.(n);
    });
    ratingButtons.push(b);
    ratingBox.appendChild(b);
  }

  const tagBoxes: HTMLInputElement[] = [];
  const commentInput = h("input", { type: "text", placeholder: "comment (for 'other')", class: "small" });
  const tagsWrap = h("div", { class: "tags" });
  const fireTags = () => {
    const selected = tagBoxes.filter((c) => c.checked).map((c) => c.value);
    hooks.onTags?.(selected, commentInput.value);
  };
  for (const tag of FAILURE_TAGS) {
    const cb = h("input", { type: "checkbox", value: tag }) as HTMLInputElement;
    cb.addEventListener("change", fireTags);
    tagBoxes.push(cb);
    tagsWrap.appendChild(h("label", {}, cb, ` ${tag}`));
  }
  commentInput.addEventListener("change", fireTags);
  tagsWrap.appendChild(commentInput);

  const promoteBtn = h("button", { class: "small", title: "Store (prompt, spec) as a few-shot exemplar" }, "☆ Promote to exemplar");
  promoteBtn.addEventListener("click", () => {
    promoteBtn.textContent = "★ Promoted";
    promoteBtn.disabled = true;
    hooks.onPromote?.();
  });

  const extra = h(
    "div",
    { class: "card-extra" },
    h("div", {}, h("span", { class: "rating-label" }, "Would use in teaching:"), ratingBox, " ", promoteBtn),
    h("details", {}, h("summary", {}, "Tag failure"), tagsWrap),
    h("details", {}, h("summary", {}, "Spec JSON (editable)"), specArea, h("div", {}, rerenderBtn)),
    lintBox,
    metaLine,
  );

  const root = h(
    "div",
    { class: "card" },
    h("div", { class: "card-head" }, h("div", { class: "card-title" }, title), h("div", { class: "card-sub" }, subtitle)),
    status,
    stageHost,
    controls,
    extra,
  );

  let handle: RenderHandle | null = null;

  function buildControls(hd: RenderHandle): void {
    controls.replaceChildren();
    const playBtn = h("button", { class: "small", title: "Play / pause" }, "▶ Play");
    const stopBtn = h("button", { class: "small", title: "Reset to start" }, "⟲");
    const backBtn = h("button", { class: "small", title: "Step back one command" }, "|◀");
    const fwdBtn = h("button", { class: "small", title: "Step forward one command" }, "▶|");
    const modeSel = h("select", { title: "Playback mode" });
    for (const m of ["narrated", "silent", "instant"]) modeSel.appendChild(h("option", { value: m }, m));
    const speedSel = h("select", { title: "Speed multiplier" });
    for (const s of ["0.5", "0.75", "1", "1.5", "2"]) {
      const o = h("option", { value: s }, `${s}×`);
      if (s === "1") o.setAttribute("selected", "");
      speedSel.appendChild(o);
    }
    const stepInd = h("span", { class: "step-indicator" });

    playBtn.addEventListener("click", () => {
      if (hd.timeline.state === "playing") hd.timeline.pause();
      else void hd.timeline.play();
    });
    stopBtn.addEventListener("click", () => hd.timeline.stop());
    backBtn.addEventListener("click", () => hd.timeline.stepBack());
    fwdBtn.addEventListener("click", () => hd.timeline.stepForward());
    modeSel.addEventListener("change", () => hd.timeline.setMode(modeSel.value as "narrated" | "silent" | "instant"));
    speedSel.addEventListener("change", () => hd.timeline.setSpeed(parseFloat(speedSel.value)));

    hd.timeline.callbacks = {
      onState: (s) => {
        playBtn.textContent = s === "playing" ? "⏸ Pause" : s === "done" ? "▶ Replay" : "▶ Play";
      },
      onStep: (done, total) => {
        stepInd.textContent = `command ${done}/${total}`;
      },
    };
    stepInd.textContent = `command 0/${hd.plan.steps.length}`;

    controls.append(playBtn, backBtn, fwdBtn, stopBtn, modeSel, speedSel, h("span", { class: "spacer" }), stepInd);
  }

  return {
    root,
    stageHost,
    setStatus: (text, kind = "info") => {
      status.textContent = text;
      status.className = `card-status ${kind === "info" ? "" : kind}`.trim();
    },
    attachHandle: (hd) => {
      handle = hd;
      buildControls(hd);
    },
    showRawSvg: (svg) => {
      const wrap = h("div", { class: "cs-baseline" });
      wrap.innerHTML = svg;
      stageHost.replaceChildren(
        wrap,
        h("div", { class: "cs-baseline-note" }, "Raw-SVG baseline: unaided LLM output — no spec, no layout engine, no lint."),
      );
    },
    setSpecText: (spec) => {
      specArea.value = JSON.stringify(spec, null, 2);
    },
    setLint: (issues, warnings) => {
      lintBox.replaceChildren();
      if (issues.length === 0 && warnings.length === 0) {
        lintBox.appendChild(h("div", { class: "lint-clean" }, "Lint clean ✓"));
        return;
      }
      const ul = h("ul", { class: "lint-list" });
      for (const i of issues) ul.appendChild(h("li", { class: i.severity }, `${i.rule}: ${i.message}`));
      for (const w of warnings) ul.appendChild(h("li", {}, `layout: ${w}`));
      lintBox.appendChild(ul);
    },
    setMetaLine: (text) => {
      metaLine.textContent = text;
    },
    destroy: () => {
      handle?.destroy();
      root.remove();
    },
  };
}
