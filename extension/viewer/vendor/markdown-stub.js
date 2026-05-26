// CSP-safe stub for markdown-it. Markdown file loading isn't available in the
// bundled extension viewer (remote module imports are blocked). The extension
// feeds the viewer an already-parsed Source, so this is only a guard.

export default class MarkdownIt {
  constructor() {
    throw new Error("마크다운 불러오기는 확장프로그램 뷰어에서 지원되지 않습니다.");
  }
}
