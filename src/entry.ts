// Entry router: #gdoc=<google-doc-id> boots the standalone viewer (a single
// player, no harness/AI); anything else loads the full experiment harness.
// Code-split so viewers never download the harness or the Anthropic SDK.

const hash = location.hash;
if (/[#&]gdoc[=-]/.test(hash)) {
  void import("./viewer").then(({ parseViewerHash, runViewer }) => {
    const req = parseViewerHash(hash);
    if (req) void runViewer(req);
  });
} else {
  void import("./main");
}

// Switching between modes requires a reload (the harness builds eagerly).
window.addEventListener("hashchange", () => location.reload());

export {};
