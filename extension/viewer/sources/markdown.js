// sources/markdown.js
// Convert a markdown text blob into the common block model. Uses
// markdown-it's token stream — easier than parsing the rendered HTML — and
// maps each top-level token sequence into one of our block types.
//
// CDN ESM import. No bundler / npm.

import MarkdownIt from "../vendor/markdown-stub.js";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

export async function markdownSourceFromFile(file) {
  const text = await file.text();
  return markdownSource(text, {
    title: stripExt(file.name),
    fileName: file.name,
  });
}

export function markdownSource(mdText, opts = {}) {
  const tokens = md.parse(mdText, {});
  const blocks = tokensToBlocks(tokens);

  // If the first block is an h1, lift it out as the title.
  let title = opts.title || "(untitled)";
  if (
    blocks.length > 0 &&
    blocks[0].type === "heading" &&
    blocks[0].level === 1
  ) {
    title = blocks[0].text;
    blocks.shift();
  }

  return {
    id: `src-md-${shortId()}`,
    kind: "markdown",
    title,
    blocks,
    meta: {
      fileName: opts.fileName,
      loadedAt: Date.now(),
    },
  };
}

function tokensToBlocks(tokens) {
  const blocks = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];

    if (t.type === "heading_open") {
      const level = parseInt(t.tag.slice(1), 10);
      const inline = tokens[i + 1];
      const text = inline && inline.type === "inline" ? inline.content : "";
      blocks.push({ type: "heading", level, text });
      i = nextAfterClose(tokens, i, "heading_close");
      continue;
    }

    if (t.type === "paragraph_open") {
      const inline = tokens[i + 1];
      const text = inline && inline.type === "inline" ? inline.content : "";
      if (text.trim().length > 0) blocks.push({ type: "paragraph", text });
      i = nextAfterClose(tokens, i, "paragraph_close");
      continue;
    }

    if (t.type === "blockquote_open") {
      // Flatten any nested paragraphs into a single blockquote block.
      const inner = [];
      let j = i + 1;
      while (j < tokens.length && tokens[j].type !== "blockquote_close") {
        if (tokens[j].type === "inline") inner.push(tokens[j].content);
        j++;
      }
      if (inner.length) {
        blocks.push({ type: "blockquote", text: inner.join("\n\n") });
      }
      i = j + 1;
      continue;
    }

    if (t.type === "bullet_list_open" || t.type === "ordered_list_open") {
      const ordered = t.type === "ordered_list_open";
      const items = [];
      let j = i + 1;
      const close = ordered ? "ordered_list_close" : "bullet_list_close";
      while (j < tokens.length && tokens[j].type !== close) {
        if (tokens[j].type === "inline") items.push(tokens[j].content);
        j++;
      }
      if (items.length) blocks.push({ type: "list", ordered, items });
      i = j + 1;
      continue;
    }

    if (t.type === "fence" || t.type === "code_block") {
      blocks.push({ type: "code", text: t.content.replace(/\n$/, "") });
      i++;
      continue;
    }

    if (t.type === "hr") {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    i++; // unknown / inline tokens we don't handle at block level
  }
  return blocks;
}

function nextAfterClose(tokens, from, closeType) {
  for (let j = from + 1; j < tokens.length; j++) {
    if (tokens[j].type === closeType) return j + 1;
  }
  return tokens.length;
}

function stripExt(name) {
  return name.replace(/\.(md|markdown|txt)$/i, "");
}

function shortId() {
  return Math.random().toString(36).slice(2, 8);
}
