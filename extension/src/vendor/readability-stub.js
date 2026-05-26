// CSP-safe stub for @mozilla/readability. In the extension the article is
// extracted from the live page by extract.js, so the viewer's URL loader
// (sources/web.js) is never exercised. If it is, fail with a clear message.

export class Readability {
  constructor() {
    throw new Error(
      "URL 직접 불러오기는 확장프로그램 뷰어에서 지원되지 않습니다. 페이지에서 추출하세요.",
    );
  }
}
