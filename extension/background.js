// background.js — service worker. Keyboard shortcuts:
//   open-in-layer2  → capture the active tab and open the viewer now
//   save-to-layer2  → capture into the saved library (read it from the viewer)
// The popup buttons call the same captureAndOpen / captureAndSave flows.

import { captureAndOpen, captureAndSave } from "./extract.js";

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  try {
    if (command === "open-in-layer2") {
      await captureAndOpen(tab.id);
    } else if (command === "save-to-layer2") {
      await captureAndSave(tab.id);
      flashBadge("✓");
    }
  } catch (err) {
    console.error("[layer2] capture failed:", err);
    flashBadge("!");
  }
});

function flashBadge(text) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#d9362b" });
  setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
}
