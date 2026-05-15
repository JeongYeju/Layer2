// cursor-hud.js
// Temporary tuning panel for the pencil cursor.
// Adjust glyph position + SVG size + rotation + hotspot with sliders, see the
// cursor update live over the reader, then copy the values when you're happy.
// Remove the `initCursorHud()` call from app.js when done — the whole file
// can then be deleted.

const DEFAULTS = {
  glyphX: 0,
  glyphY: 22,
  fontSize: 22,
  svgSize: 24,
  rotate: 180,
  hotspotX: 16,
  hotspotY: 8,
};

export function initCursorHud() {
  const hud = document.createElement("div");
  hud.id = "cursor-hud";
  hud.innerHTML = `
    <div class="hud-title">✏️ Cursor Tuner</div>
    ${row("glyphX", "Glyph X", -16, 32, DEFAULTS.glyphX)}
    ${row("glyphY", "Glyph Y", 0, 48, DEFAULTS.glyphY)}
    ${row("fontSize", "Font Size", 10, 40, DEFAULTS.fontSize)}
    ${row("svgSize", "SVG Size", 16, 48, DEFAULTS.svgSize)}
    ${row("rotate", "Rotate", 0, 360, DEFAULTS.rotate)}
    ${row("hotspotX", "Hotspot X", 0, 48, DEFAULTS.hotspotX)}
    ${row("hotspotY", "Hotspot Y", 0, 48, DEFAULTS.hotspotY)}
    <div class="hud-actions">
      <button id="hud-copy" type="button">Copy values</button>
      <button id="hud-reset" type="button">Reset</button>
      <button id="hud-close" type="button">Close</button>
    </div>
    <pre id="hud-output"></pre>
  `;
  document.body.appendChild(hud);

  const styleEl = document.createElement("style");
  styleEl.id = "hud-cursor-style";
  document.head.appendChild(styleEl);

  const state = { ...DEFAULTS };

  // Wire sliders
  Object.keys(DEFAULTS).forEach((key) => {
    const input = hud.querySelector(`#hud-${key}`);
    const valEl = hud.querySelector(`#hud-${key}-val`);
    input.addEventListener("input", () => {
      state[key] = parseInt(input.value, 10);
      valEl.textContent = state[key];
      apply();
    });
  });

  // Buttons
  hud.querySelector("#hud-copy").addEventListener("click", () => {
    navigator.clipboard.writeText(snippet());
  });
  hud.querySelector("#hud-reset").addEventListener("click", () => {
    Object.assign(state, DEFAULTS);
    Object.keys(DEFAULTS).forEach((key) => {
      hud.querySelector(`#hud-${key}`).value = state[key];
      hud.querySelector(`#hud-${key}-val`).textContent = state[key];
    });
    apply();
  });
  hud.querySelector("#hud-close").addEventListener("click", () => {
    hud.remove();
    styleEl.remove();
  });

  apply();

  function apply() {
    const { glyphX, glyphY, fontSize, svgSize, rotate, hotspotX, hotspotY } =
      state;
    const center = svgSize / 2;
    const url =
      `data:image/svg+xml;utf8,` +
      `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}' viewBox='0 0 ${svgSize} ${svgSize}'>` +
      `<text x='${glyphX}' y='${glyphY}' font-size='${fontSize}' font-family='Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif' transform='rotate(${rotate} ${center} ${center})'>✏️</text>` +
      `</svg>`;
    styleEl.textContent = `
      .para .g.pencil-cursor {
        cursor: url("${url}") ${hotspotX} ${hotspotY}, crosshair !important;
      }
    `;
    hud.querySelector("#hud-output").textContent = snippet();
  }

  function snippet() {
    const { glyphX, glyphY, fontSize, svgSize, rotate, hotspotX, hotspotY } =
      state;
    return [
      `glyphX=${glyphX}`,
      `glyphY=${glyphY}`,
      `fontSize=${fontSize}`,
      `svgSize=${svgSize}`,
      `rotate=${rotate}`,
      `hotspotX=${hotspotX}`,
      `hotspotY=${hotspotY}`,
    ].join("  ");
  }
}

function row(id, label, min, max, value) {
  return `
    <label class="hud-row">
      <span class="hud-label">${label}</span>
      <input type="range" id="hud-${id}" min="${min}" max="${max}" value="${value}">
      <span class="hud-val" id="hud-${id}-val">${value}</span>
    </label>
  `;
}
