// popup.js — two actions: "지금 읽기" opens the bundled viewer now; "저장"
// clips the page into the library for later reading in the viewer web.

import { captureAndOpen, captureAndSave } from "./extract.js";

const goBtn = document.getElementById("go");
const saveBtn = document.getElementById("save");
const msg = document.getElementById("msg");

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) throw new Error("활성 탭을 찾지 못했어요.");
  return tab.id;
}

function busy(on) {
  goBtn.disabled = on;
  saveBtn.disabled = on;
}

goBtn.addEventListener("click", async () => {
  busy(true);
  msg.textContent = "본문 추출 중…";
  try {
    await captureAndOpen(await activeTabId());
    window.close();
  } catch (err) {
    msg.textContent = "실패: " + (err.message || err);
    busy(false);
  }
});

saveBtn.addEventListener("click", async () => {
  busy(true);
  msg.textContent = "저장 중…";
  try {
    const title = await captureAndSave(await activeTabId());
    msg.textContent = `저장됨 ✓ "${title || "(제목 없음)"}"`;
  } catch (err) {
    msg.textContent = "실패: " + (err.message || err);
  } finally {
    busy(false);
  }
});
