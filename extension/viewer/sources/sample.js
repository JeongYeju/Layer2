// sources/sample.js
// Wraps the hardcoded essay in content.js as a Source. This is what the
// sidebar's "샘플 글" entry loads — useful as a known-good default while
// we wire up real source loaders, and as something to read when offline.

import { content } from "../content.js";

export function sampleSource() {
  return {
    id: "src-sample",
    kind: "sample",
    title: content.title,
    byline: content.byline || "Layer 2 — 읽기 행위에 대한 노트",
    blocks: content.paragraphs.map((p) => ({
      type: "paragraph",
      text: p.text,
    })),
    meta: {
      loadedAt: Date.now(),
    },
  };
}
