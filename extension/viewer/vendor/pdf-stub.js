// CSP-safe stub for pdfjs-dist. PDF loading isn't available in the bundled
// extension viewer (remote module imports are blocked). GlobalWorkerOptions is
// a settable object so sources/pdf.js's top-level workerSrc assignment is a
// no-op; getDocument throws if anything actually tries to parse a PDF.

export const GlobalWorkerOptions = {};

export function getDocument() {
  throw new Error("PDF 불러오기는 확장프로그램 뷰어에서 지원되지 않습니다.");
}
