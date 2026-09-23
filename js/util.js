const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export function fmt(v, digits = 3) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(2);
  return String(Number(v.toPrecision(digits)));
}
export const pct = (v, d = 1) => (v === null || v === undefined ? "—" : (100 * v).toFixed(d) + "%");
export const signed = (v, d = 3) => (Number.isFinite(v) ? (v > 0 ? "+" : "") + fmt(v, d) : "—");

const cache = new Map();
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function downloadText(filename, text, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const PARAM_LABEL = { Iddq: "Iddq", Leakage: "Leakage", Prop_Delay: "Prop. delay" };
export const TYPE_LABEL = {
  gross_outlier: "Gross outlier", lot_outlier: "Lot outlier", accel_drift: "Accelerating drift",
  late_bloomer: "Late bloomer", step_jump: "Step jump", erratic: "Erratic",
};
export const typeLabel = (t) => (t ? t.split(",").map((x) => TYPE_LABEL[x] || x).join(", ") : "");
export const badge = (d) => `<span class="badge ${esc(d)}">${esc(d)}</span>`;
