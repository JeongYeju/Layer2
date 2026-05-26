// CSP-safe stub for @chenglou/pretext, used only by the bundled extension
// viewer (MV3 forbids remote module imports). The real pretext computes line
// layout from text; here we return an empty layout. pretext_helpers.js already
// treats empty `lines` as a graceful fallback: signal LayoutCursors become
// null, but the DOM-based reading cursor (portal.js) and highlight visuals are
// unaffected because they read rendered grapheme spans, not pretext.

export function prepareWithSegments(text /*, font */) {
  return { text };
}

export function layoutWithLines(/* prepared, widthPx, lineHeight */) {
  return { lines: [] };
}
