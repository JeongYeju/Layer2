// background.js — service worker. Handles the keyboard shortcut
// (Cmd/Ctrl+Shift+L) by capturing the active tab's article and opening the
// Layer2 viewer. The popup button uses the same captureAndOpen flow.

import { captureAndOpen } from "./extract.js";

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "open-in-layer2") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  try {
    await captureAndOpen(tab.id);
  } catch (err) {
    console.error("[layer2] capture failed:", err);
  }
});
