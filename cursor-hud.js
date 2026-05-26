// cursor-hud.js
// Temporary tuning panel for the pencil cursor + the reading-mode portal.
//
// Cursor section: adjust pencil glyph position / size / rotation / hotspot
// with sliders, see the cursor update live over the reader.
//
// Portal section: line-break angle slider + a live motion-vector viz. The
// vector reads portal.js's decay-accumulated (rawDx, rawDy); the wedge
// fill is the "vertical-dominant" zone defined by the angle threshold —
// when the vector enters a wedge, portal.js will commit a line change.
//
// Remove the `initCursorHud()` call from app.js when the tuning is done.

const DEFAULTS = {
  glyphX: 0,
  glyphY: 22,
  fontSize: 22,
  svgSize: 24,
  rotate: 0, // normal-mode pencil is vertically flipped (see apply); rotate is extra
  hotspotX: 3,
  hotspotY: 0,
};

const PORTAL_DEFAULTS = {
  breakAngle: 33, // degrees from horizontal
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

    <div class="hud-title" style="margin-top:14px">📖 Portal</div>
    ${row("breakAngle", "Line break angle", 10, 85, PORTAL_DEFAULTS.breakAngle)}
    <div class="hud-motion" id="hud-motion">
      <svg viewBox="-50 -50 100 100" width="100" height="100">
        <!-- wedges fill the "vertical-dominant" zones implied by the angle
             threshold; vector lands here → line transition fires. -->
        <path id="hud-wedge-up"   fill="rgba(217,54,43,0.18)"></path>
        <path id="hud-wedge-down" fill="rgba(217,54,43,0.18)"></path>
        <circle cx="0" cy="0" r="44" fill="none" stroke="#e6e1d6" stroke-width="0.5"></circle>
        <line x1="-46" x2="46" y1="0" y2="0" stroke="#cfc8bc" stroke-width="0.5"></line>
        <line x1="0" x2="0" y1="-46" y2="46" stroke="#cfc8bc" stroke-width="0.5"></line>
        <line id="hud-vector" x1="0" y1="0" x2="0" y2="0"
              stroke="#1c1a18" stroke-width="2.5" stroke-linecap="round"></line>
        <circle cx="0" cy="0" r="2" fill="#1c1a18"></circle>
      </svg>
      <div class="hud-motion-meta">
        <div><span>angle</span><b id="hud-motion-angle">0°</b></div>
        <div><span>locked</span><b id="hud-motion-locked">no</b></div>
      </div>
    </div>

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

  // Wire pencil-cursor sliders.
  Object.keys(DEFAULTS).forEach((key) => {
    const input = hud.querySelector(`#hud-${key}`);
    const valEl = hud.querySelector(`#hud-${key}-val`);
    input.addEventListener("input", () => {
      state[key] = parseInt(input.value, 10);
      valEl.textContent = state[key];
      apply();
    });
  });

  // Portal — line-break angle. Writes into window.__portalConfig which
  // portal.js reads from each move. Also triggers a wedge redraw so the
  // viz reflects the threshold immediately.
  const breakAngleEl = hud.querySelector("#hud-breakAngle");
  const breakAngleValEl = hud.querySelector("#hud-breakAngle-val");
  const writeBreakAngle = (val) => {
    window.__portalConfig = window.__portalConfig || {};
    window.__portalConfig.lineBreakAngle = val;
    breakAngleValEl.textContent = `${val}°`;
    drawWedges(val);
  };
  breakAngleEl.addEventListener("input", () => {
    writeBreakAngle(parseInt(breakAngleEl.value, 10));
  });
  writeBreakAngle(parseInt(breakAngleEl.value, 10));

  // Live vector viz. Reads window.__portalMotion (exposed by portal.js).
  const vectorEl = hud.querySelector("#hud-vector");
  const angleEl = hud.querySelector("#hud-motion-angle");
  const lockedEl = hud.querySelector("#hud-motion-locked");
  let vizRaf = null;
  const tickViz = () => {
    const m = window.__portalMotion;
    if (m) {
      const px = m.rawDx;
      const py = m.rawDy;
      const mag = Math.hypot(px, py);
      // Scale: clamp the arrow length to the box radius (~40).
      const s = mag > 0.1 ? Math.min(40 / mag, 4) : 0;
      vectorEl.setAttribute("x2", (px * s).toFixed(1));
      vectorEl.setAttribute("y2", (py * s).toFixed(1));
      // Two-stage feedback matching portal.js:
      //   - "intent" (gold): angle is past threshold but |rawDy| hasn't
      //     hit COMMIT_DY yet → cursor is only leaning visually
      //   - "commit" (ink red): both gates passed → line transition fires
      const intent =
        m.angleDeg >= m.threshold && Math.abs(py) > 4;
      const commit = intent && Math.abs(py) >= (m.commitDy ?? 17);
      vectorEl.setAttribute(
        "stroke",
        commit ? "#d9362b" : intent ? "#c89a2c" : "#1c1a18",
      );
      angleEl.textContent = `${m.angleDeg.toFixed(0)}°`;
      lockedEl.textContent = m.locked ? "yes" : "no";
      lockedEl.style.color = m.locked ? "#d9362b" : "#7a736b";
    }
    vizRaf = requestAnimationFrame(tickViz);
  };
  vizRaf = requestAnimationFrame(tickViz);

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
    breakAngleEl.value = PORTAL_DEFAULTS.breakAngle;
    writeBreakAngle(PORTAL_DEFAULTS.breakAngle);
    apply();
  });
  hud.querySelector("#hud-close").addEventListener("click", () => {
    if (vizRaf) cancelAnimationFrame(vizRaf);
    hud.remove();
    styleEl.remove();
  });

  apply();

  // Draw the two "vertical-dominant" wedges. SVG y is down-positive, so
  // sin(theta) matches screen y directly. For threshold T:
  //   upper wedge: theta in [-180+T, -T]  (vector points up, ratio > tan T)
  //   lower wedge: theta in [T, 180-T]    (vector points down, same)
  // We render each as M(origin) → L(corner1) → A(arc) → corner2 → Z.
  function drawWedges(threshold) {
    const r = 44;
    const T = threshold;
    const arcPath = (t1, t2) => {
      const rad = (d) => (d * Math.PI) / 180;
      const p1x = (Math.cos(rad(t1)) * r).toFixed(2);
      const p1y = (Math.sin(rad(t1)) * r).toFixed(2);
      const p2x = (Math.cos(rad(t2)) * r).toFixed(2);
      const p2y = (Math.sin(rad(t2)) * r).toFixed(2);
      // sweep flag 1 = arc goes the "short way" in CCW within SVG coords.
      return `M 0 0 L ${p1x} ${p1y} A ${r} ${r} 0 0 1 ${p2x} ${p2y} Z`;
    };
    hud.querySelector("#hud-wedge-up").setAttribute("d", arcPath(-180 + T, -T));
    hud.querySelector("#hud-wedge-down").setAttribute("d", arcPath(T, 180 - T));
  }

  function apply() {
    const { glyphX, glyphY, fontSize, svgSize, rotate, hotspotX, hotspotY } =
      state;
    const center = svgSize / 2;
    const url =
      `data:image/svg+xml;utf8,` +
      `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}' viewBox='0 0 ${svgSize} ${svgSize}'>` +
      `<text x='${glyphX}' y='${glyphY}' font-size='${fontSize}' font-family='Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif' transform='translate(0 ${svgSize}) scale(1 -1) rotate(${rotate} ${center} ${center})'>✏️</text>` +
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
    const angle = parseInt(breakAngleEl.value, 10);
    return [
      `glyphX=${glyphX}`,
      `glyphY=${glyphY}`,
      `fontSize=${fontSize}`,
      `svgSize=${svgSize}`,
      `rotate=${rotate}`,
      `hotspotX=${hotspotX}`,
      `hotspotY=${hotspotY}`,
      `lineBreakAngle=${angle}`,
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
