// sources/web.js
// Pull a web article via fetch + Mozilla Readability — same heuristic the
// browser "Reader Mode" uses. We feed the page HTML into Readability, get
// back a cleaned-up article (title + content HTML), then walk the
// content's DOM and translate it into our common block model.
//
// CORS: most major sites refuse cross-origin fetches. We try direct first,
// then fall back through a list of public CORS proxies. This is sufficient
// for dev / Phase 1; Phase 3 (Vercel) will replace this with our own
// /api/fetch endpoint so we're not depending on third-party uptime, privacy,
// or rate limits.

import { Readability } from "../vendor/readability-stub.js";

// Public CORS proxies, tried in order. Each is a function URL → proxied URL.
// If you want to disable proxies entirely, set window.__webConfig = { useProxies: false }.
const CORS_PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

export async function webSourceFromUrl(url) {
  const html = await fetchHtmlWithFallback(url);
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

// Try the URL directly first; if that fails for CORS or any other reason,
// fall back through the public proxies until one returns HTML. Throws with
// a combined error message if everything fails so the sidebar can show it.
async function fetchHtmlWithFallback(url) {
  const errs = [];
  // Direct attempt.
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 200) return text;
      errs.push(`direct: empty response`);
    } else {
      errs.push(`direct: HTTP ${res.status}`);
    }
  } catch (e) {
    errs.push(`direct: ${e.message || e}`);
  }
  // Proxy fallbacks.
  const useProxies = window.__webConfig?.useProxies !== false;
  if (useProxies) {
    for (const proxyFn of CORS_PROXIES) {
      const proxied = proxyFn(url);
      try {
        const res = await fetch(proxied, {
          mode: "cors",
          credentials: "omit",
        });
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 200) return text;
          errs.push(`${hostname(proxied)}: empty response`);
        } else {
          errs.push(`${hostname(proxied)}: HTTP ${res.status}`);
        }
      } catch (e) {
        errs.push(`${hostname(proxied)}: ${e.message || e}`);
      }
    }
  }
  throw new Error(`Couldn't fetch ${url} — tried: ${errs.join(" | ")}`);
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
