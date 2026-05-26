// sources/web.js
// Pull a web article via fetch + Mozilla Readability — same heuristic the
// browser "Reader Mode" uses. We feed the page HTML into Readability, get
// back a cleaned-up article (title + content HTML), then walk the
// content's DOM and translate it into our common block model.
//
// CORS caveat: many sites refuse cross-origin fetches without a proxy. We
// surface the failure verbatim so the sidebar can show "이 사이트는 직접
// 가져올 수 없어요" and continue. A backend proxy goes into Phase 2.

import { Readability } from "https://esm.sh/@mozilla/readability@0.5";

export async function webSourceFromUrl(url) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  const html = await res.text();
  // Readability wants a Document. We have to build one with a base URL set
  // so relative links inside the article resolve sensibly.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const base = parsed.createElement("base");
  base.setAttribute("href", url);
  parsed.head.insertBefore(base, parsed.head.firstChild);

  const reader = new Readability(parsed);
  const article = reader.parse();
  if (!article || !article.content) {
    throw new Error("Readability couldn't extract an article body.");
  }

  // article.content is an HTML string. Re-parse it in a fresh document so
  // we can walk it without leaking event handlers / scripts.
  const articleDoc = new DOMParser().parseFromString(
    `<div>${article.content}</div>`,
    "text/html",
  );
  const root = articleDoc.body.firstElementChild;
  const blocks = root ? domToBlocks(root) : [];

  return {
    id: `src-web-${shortId()}`,
    kind: "web",
    title: article.title || hostname(url),
    byline: article.byline || hostname(url),
    blocks,
    meta: {
      url,
      excerpt: article.excerpt,
      siteName: article.siteName,
      loadedAt: Date.now(),
    },
  };
}

function domToBlocks(root) {
  const blocks = [];
  for (const node of root.children) {
    const tag = node.tagName.toLowerCase();
    const text = node.textContent.replace(/\s+/g, " ").trim();

    if (/^h[1-6]$/.test(tag)) {
      if (!text) continue;
      blocks.push({
        type: "heading",
        level: parseInt(tag.slice(1), 10),
        text,
      });
    } else if (tag === "p") {
      if (text) blocks.push({ type: "paragraph", text });
    } else if (tag === "blockquote") {
      if (text) blocks.push({ type: "blockquote", text });
    } else if (tag === "ul" || tag === "ol") {
      const items = Array.from(node.querySelectorAll(":scope > li"))
        .map((li) => li.textContent.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      if (items.length) {
        blocks.push({ type: "list", ordered: tag === "ol", items });
      }
    } else if (tag === "pre") {
      const codeText = node.textContent;
      if (codeText.trim()) {
        blocks.push({ type: "code", text: codeText.replace(/\n$/, "") });
      }
    } else if (tag === "hr") {
      blocks.push({ type: "hr" });
    } else if (tag === "div" || tag === "section" || tag === "article") {
      // Descend into structural wrappers.
      blocks.push(...domToBlocks(node));
    } else if (text) {
      blocks.push({ type: "paragraph", text });
    }
  }
  return blocks;
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}
