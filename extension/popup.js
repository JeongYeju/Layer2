// popup.js — the toolbar popup. Captures the active tab's article and opens
// the Layer2 viewer, then closes itself.

import { captureAndOpen } from "./extract.js";

const btn = document.getElementById("go");
const msg = document.getElementById("msg");

btn.addEventListener("click", async () => {
  btn.disabled = true;
  msg.textContent = "본문 추출 중…";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error("활성 탭을 찾지 못했어요.");
    await captureAndOpen(tab.id);
    window.close();
  } catch (err) {
    msg.textContent = "실패: " + (err.message || err);
    btn.disabled = false;
  }
});
