// boot-ext.js — extension viewer entry. Reads the article the extension
// captured (chrome.storage.local) and hands it to the standalone viewer via
// window.__layer2InjectedSource before app.js boots. This file replaces the
// plain `app.js` script tag in the bundled viewer's index.html.

const { layer2Source } = await chrome.storage.local.get("layer2Source");
if (layer2Source) {
  window.__layer2InjectedSource = layer2Source;
}
await import("./app.js");
