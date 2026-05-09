// app.js — entry point. Wire modules in order.

import { renderReader } from "./reader.js";
import { initBaselineCollectors } from "./signals.js";
import { renderToolbar } from "./toolbar.js";
import { renderDashboard } from "./dashboard.js";
import { initHighlight } from "./highlight.js";

const reader = document.getElementById("reader");
const dashboard = document.getElementById("dashboard");
const toolbar = document.getElementById("toolbar");

renderReader(reader);
renderToolbar(toolbar);
renderDashboard(dashboard);
initBaselineCollectors({ readerEl: reader });
initHighlight();
