// Minimal hand-rolled SVG charting: scales, axes, responsive mounting and a generic line chart.
import { esc, fmt } from "./util.js";

function niceStep(span, n) {
  const raw = span / Math.max(1, n);
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m >= 5 ? 10 : m >= 2 ? 5 : m >= 1 ? 2 : 1) * p;
}

export function linear(d0, d1, r0, r1) {
  if (d1 === d0) { d0 -= 1; d1 += 1; }
  const f = (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  f.domain = [d0, d1];
  f.ticks = (n = 5) => {
    const s = niceStep(d1 - d0, n);
    const out = [];
    for (let v = Math.ceil(d0 / s) * s; v <= d1 + s * 1e-9; v += s) out.push(Math.abs(v) < s * 1e-9 ? 0 : v);
    return out;
  };
  return f;
}

export function log(d0, d1, r0, r1) {
  const l0 = Math.log10(d0), l1 = Math.log10(d1);
  const f = (v) => r0 + ((Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0 || 1)) * (r1 - r0);
  f.domain = [d0, d1];
  f.ticks = () => {
    const out = [];
    const mults = l1 - l0 > 2.5 ? [1] : l1 - l0 > 1.2 ? [1, 2, 5] : [1, 1.5, 2, 3, 5, 7];
    for (let e = Math.floor(l0); e <= Math.ceil(l1); e++)
      for (const m of mults) { const v = m * 10 ** e; if (v >= d0 * 0.999 && v <= d1 * 1.001) out.push(v); }
    return out;
  };
  return f;
}

// Pad a data extent so points don't sit on the frame.
export function extent(values, { pad = 0.06, logScale = false, include = [] } = {}) {
  const v = values.concat(include).filter((x) => Number.isFinite(x) && (!logScale || x > 0));
  let lo = Math.min(...v), hi = Math.max(...v);
  if (logScale) {
    const a = Math.log10(lo), b = Math.log10(hi), p = (b - a || 1) * pad;
    return [10 ** (a - p), 10 ** (b + p)];
  }
  const p = (hi - lo || Math.abs(hi) || 1) * pad;
  return [lo - p, hi + p];
}

export function axisLeft(y, x0, x1, tickFmt = fmt) {
  return y.ticks(5).map((t) => {
    const py = y(t).toFixed(1);
    return `<line class="grid-line" x1="${x0}" x2="${x1}" y1="${py}" y2="${py}"/>` +
      `<text x="${x0 - 8}" y="${py}" text-anchor="end" dominant-baseline="middle">${esc(tickFmt(t))}</text>`;
  }).join("");
}

export function axisBottom(x, y0, ticks, tickFmt = fmt) {
  let tk = ticks || x.ticks(6);
  const span = Math.abs(x(tk[tk.length - 1]) - x(tk[0]));
  const step = Math.max(1, Math.ceil(tk.length / Math.max(2, span / 46)));
  if (step > 1) tk = tk.filter((_, i) => i % step === 0);
  return tk.map((t) => {
    const px = x(t).toFixed(1);
    return `<line class="axis" x1="${px}" x2="${px}" y1="${y0}" y2="${y0 + 4}" stroke="var(--line)"/>` +
      `<text x="${px}" y="${y0 + 17}" text-anchor="middle">${esc(tickFmt(t))}</text>`;
  }).join("");
}

// Re-render an SVG string producer whenever the container width changes.
export function mount(container, draw) {
  let lastW = 0;
  const render = () => {
    const w = Math.round(container.clientWidth);
    if (!w || w === lastW) return;
    lastW = w;
    container.innerHTML = draw(w);
    container.dispatchEvent(new CustomEvent("rendered"));
  };
  const ro = new ResizeObserver(render);
  ro.observe(container);
  render();
  return { redraw: () => { lastW = 0; render(); }, disconnect: () => ro.disconnect() };
}

// Shared hover tooltip for elements carrying data-tip.
export function tooltips(container) {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  tip.setAttribute("role", "status");
  container.style.position = "relative";
  container.appendChild(tip);
  container.addEventListener("pointermove", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) { tip.classList.remove("show"); return; }
    const r = container.getBoundingClientRect();
    tip.textContent = t.getAttribute("data-tip");
    tip.style.left = `${e.clientX - r.left}px`;
    tip.style.top = `${e.clientY - r.top}px`;
    tip.classList.add("show");
  });
  container.addEventListener("pointerleave", () => tip.classList.remove("show"));
  return tip;
}

/**
 * Generic line chart.
 * series: [{ name, color, points: [[x, y], ...], dash?, width? }]
 * opts: { height, xLog, xLabel, yLabel, xFmt, yFmt, yDomain, xTicks, markers: [{ x, label }] }
 */
export function lineChart(series, opts = {}) {
  return (w) => {
    const H = opts.height || 260, m = { l: 52, r: 16, t: 14, b: opts.xLabel ? 44 : 30 };
    const xs = series.flatMap((s) => s.points.map((p) => p[0]));
    const ys = series.flatMap((s) => s.points.map((p) => p[1]));
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const x = (opts.xLog ? log : linear)(x0, x1, m.l, w - m.r);
    const yd = opts.yDomain || extent(ys, { pad: 0.08 });
    const y = linear(yd[0], yd[1], H - m.b, m.t);
    const xf = opts.xFmt || fmt, yf = opts.yFmt || fmt;
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(opts.aria || opts.yLabel || "chart")}">`;
    s += axisLeft(y, m.l, w - m.r, yf);
    let xt = opts.xTicks || (opts.xLog ? [...new Set(xs)] : x.ticks(6));
    const maxTicks = Math.max(2, Math.floor((w - m.l - m.r) / 46));
    if (xt.length > maxTicks) { const step = Math.ceil(xt.length / maxTicks); xt = xt.filter((_, i) => i % step === 0); }
    s += axisBottom(x, H - m.b, xt, xf);
    if (opts.xLabel) s += `<text x="${(m.l + w - m.r) / 2}" y="${H - 6}" text-anchor="middle">${esc(opts.xLabel)}</text>`;
    for (const mk of opts.markers || []) {
      const px = x(mk.x);
      s += `<line x1="${px}" x2="${px}" y1="${m.t}" y2="${H - m.b}" stroke="var(--text)" stroke-dasharray="3 3" opacity=".5"/>` +
        `<text x="${px + 5}" y="${m.t + 10}" style="fill:var(--text)">${esc(mk.label)}</text>`;
    }
    for (const se of series) {
      const d = se.points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
      s += `<path d="${d}" fill="none" style="stroke:${se.color}" stroke-width="${se.width || 2}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} stroke-linejoin="round"/>`;
      if (se.dots !== false)
        s += se.points.map((p) => `<circle cx="${x(p[0]).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="3.2" style="fill:${se.color}" data-tip="${esc(`${se.name} · ${opts.xName || "x"} ${xf(p[0])}: ${yf(p[1])}`)}"/>`).join("");
    }
    return s + "</svg>";
  };
}

export const legend = (items) =>
  `<div class="legend">${items.map((i) => `<span><i class="${i.kind || ""}" style="background:${i.color}${i.dash ? ";background:repeating-linear-gradient(90deg," + i.color + " 0 4px,transparent 4px 7px)" : ""}"></i>${esc(i.name)}</span>`).join("")}</div>`;
