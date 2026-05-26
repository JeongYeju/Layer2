// extract.js
// Shared capture flow for popup.js and background.js. The article extractor
// runs in the page (via chrome.scripting) and turns the live DOM into the
// Layer2 common Source block model — no Readability dependency, just a
// main-content heuristic. The result is stashed in chrome.storage.local and
// the bundled viewer is opened in a new tab, where boot-ext.js picks it up.

export async function captureAndOpen(tabId) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractArticle,
  });
  if (!result || !result.blocks || result.blocks.length === 0) {
    throw new Error("이 페이지에서 본문을 찾지 못했어요.");
  }
  await chrome.storage.local.set({ layer2Source: result, layer2At: Date.now() });
  await chrome.tabs.create({ url: chrome.runtime.getURL("viewer/index.html") });
}

// Runs INSIDE the page (chrome.scripting injects its source). Must be fully
// self-contained: no references to anything outside this function body.
function extractArticle() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function blocksFrom(root) {
    const out = [];
    const walk = (node) => {
      for (const el of node.children) {
        const tag = el.tagName.toLowerCase();
        const text = clean(el.textContent);
        if (/^h[1-6]$/.test(tag)) {
          if (text) out.push({ type: "heading", level: +tag[1], text });
        } else if (tag === "p") {
          if (text) out.push({ type: "paragraph", text });
        } else if (tag === "blockquote") {
          if (text) out.push({ type: "blockquote", text });
        } else if (tag === "ul" || tag === "ol") {
          const items = Array.from(el.querySelectorAll(":scope > li"))
            .map((li) => clean(li.textContent))
            .filter(Boolean);
          if (items.length) out.push({ type: "list", ordered: tag === "ol", items });
        } else if (tag === "pre") {
          if (el.textContent.trim()) {
            out.push({ type: "code", text: el.textContent.replace(/\n$/, "") });
          }
        } else if (["div", "section", "article", "main"].includes(tag)) {
          walk(el);
        }
      }
    };
    walk(root);
    return out;
  }

  // Pick the content root: prefer semantic containers, else the element whose
  // direct <p> children carry the most text.
  function pickRoot() {
    const semantic =
      document.querySelector("article") ||
      document.querySelector("main") ||
      document.querySelector("[role=main]");
    if (semantic) return semantic;
    let best = document.body;
    let bestScore = 0;
    for (const el of document.querySelectorAll("div, section, article, main")) {
      let score = 0;
      for (const p of el.querySelectorAll(":scope > p")) {
        score += clean(p.textContent).length;
      }
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  const root = pickRoot();
  let blocks = blocksFrom(root);
  // With plenty of content, drop ~empty paragraphs (likely nav/cruft).
  if (blocks.length > 8) {
    blocks = blocks.filter(
      (b) => b.type !== "paragraph" || (b.text && b.text.length >= 2),
    );
  }

  const meta = (sel) => document.querySelector(sel)?.content;
  const title = clean(
    meta('meta[property="og:title"]') ||
      document.querySelector("h1")?.textContent ||
      document.title ||
      location.hostname,
  );
  const byline = clean(meta('meta[name="author"]') || location.hostname);

  return {
    id: "src-ext-" + Math.random().toString(36).slice(2, 8),
    kind: "web",
    title,
    byline,
    blocks,
    meta: { url: location.href, loadedAt: Date.now() },
  };
}
