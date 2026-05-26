// content-bridge.js
// Runs as a content script on the Layer2 viewer page (localhost). The page
// can't read chrome.storage, so this bridge relays the saved-article library
// to the viewer over window.postMessage. Protocol:
//   page  → bridge: { source: "layer2-viewer", op: "list" | "delete", id? }
//   bridge → page:  { source: "layer2-ext",    op: "ready" | "list", items? }

const VIEWER = "layer2-viewer";
const EXT = "layer2-ext";

function readLibrary() {
  return new Promise((resolve) => {
    chrome.storage.local.get("layer2Library", ({ layer2Library }) => {
      resolve(Array.isArray(layer2Library) ? layer2Library : []);
    });
  });
}

async function sendList() {
  const items = await readLibrary();
  window.postMessage({ source: EXT, op: "list", items }, window.location.origin);
}

window.addEventListener("message", async (e) => {
  if (e.source !== window) return;
  const msg = e.data;
  if (!msg || msg.source !== VIEWER) return;
  if (msg.op === "list") {
    sendList();
  } else if (msg.op === "delete" && msg.id) {
    const lib = await readLibrary();
    const next = lib.filter((it) => it.source?.id !== msg.id);
    await chrome.storage.local.set({ layer2Library: next });
    sendList();
  }
});

// Push updates when the library changes (e.g. a save made while the viewer is
// open) so the saved list stays live without a manual refresh.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.layer2Library) sendList();
});

// Announce availability so the viewer can request the list immediately.
window.postMessage({ source: EXT, op: "ready" }, window.location.origin);
