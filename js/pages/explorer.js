import { badge, esc, fmt, loadJSON, PARAM_LABEL, signed, typeLabel, TYPE_LABEL } from "../util.js";
import { extent, linear, log, mount, tooltips } from "../svg.js";
import { setQuery } from "../main.js";

const TPS = ["0h", "24h", "96h", "168h"];
const T_HOURS = [0, 24, 96, 168];
const DEC_ORDER = { REJECT: 0, REVIEW: 1, ACCEPT: 2 };
const PAGE_SIZE = 40;

const CODE_HELP = {
  SPEC_FAIL: "Datasheet limit exceeded",
  MAHALANOBIS: "Multivariate lot outlier (robust Mahalanobis distance above χ² 0.999)",
  ISOLATION_FOREST: "Isolation Forest anomaly score above threshold",
  PRED_168H_OUT_OF_SPEC: "Forecast 168 h value exceeds the datasheet limit",
  SCORE_NEAR_THRESHOLD: "Combined score within 15% of the reject threshold",
  DPAT_DRIFT: "0→168 h drift outside the lot's DPAT window",
};
function codeHelp(code) {
  const c = code.split(":").pop();
  if (CODE_HELP[c]) return CODE_HELP[c];
  let m;
  if ((m = c.match(/^DELTA_FAIL_(\w+)/))) return `Change vs 0 h exceeds the delta limit (at ${m[1]})`;
  if ((m = c.match(/^DPAT_(\d+h)/))) return `Reading at ${m[1]} outside the lot's DPAT window`;
  if ((m = c.match(/^EARLY_DRIFT_(UP|DOWN)\[(\w+)\]/))) return `Forecast ${m[1] === "UP" ? "upper" : "lower"}-bound slope beyond the safety slope (binding: ${m[2]})`;
  return c;
}
const codeClass = (c) => (/SPEC_FAIL|DELTA_FAIL/.test(c) ? "bad" : /EARLY_DRIFT|PRED_168/.test(c) ? "info" : "warn");

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function outcome(p) {
  if (p.y && p.dec === "REJECT") return `<span class="chip" style="color:var(--ok)">Caught</span>`;
  if (p.y) return `<span class="chip bad">${p.dec === "REVIEW" ? "Sent to review (not rejected)" : "Escape"}</span>`;
  if (p.dec === "REJECT") return `<span class="chip warn">False reject (overkill)</span>`;
  return "";
}

// ---------------------------------------------------------------- strip plot
function stripPlot(lot, param, parts, selId) {
  const P = lot.params[param];
  return (w) => {
    const H = 380, m = { l: 56, r: 16, t: 16, b: 34 };
    const vals = parts.flatMap((p) => p.p[param].v);
    const vmin = Math.min(...vals), vmax = Math.max(...vals);
    const clip = (v) => Number.isFinite(v) && v >= vmin / 2 && v <= vmax * 2;
    const inc = [];
    for (const t of TPS) for (const b of [P.dpat[t][0], P.dpat[t][2]]) if (clip(b)) inc.push(b);
    const specOn = P.specMax != null && P.specMax <= vmax * 3;
    if (specOn) inc.push(P.specMax);
    const [d0, d1] = extent(vals, { logScale: P.logScale, include: inc, pad: 0.05 });
    const y = (P.logScale ? log : linear)(d0, d1, H - m.b, m.t);
    const cw = (w - m.l - m.r) / 4;
    const cl = (v) => Math.min(H - m.b, Math.max(m.t, y(v)));
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${param} values for lot ${lot.id} at four timepoints with DPAT windows`)}">`;
    for (const t of y.ticks(6)) {
      s += `<line class="grid-line" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/>` +
        `<text x="${m.l - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${fmt(t)}</text>`;
    }
    s += `<text x="12" y="${(H - m.b + m.t) / 2}" transform="rotate(-90 12 ${(H - m.b + m.t) / 2})" text-anchor="middle">${esc(`${PARAM_LABEL[param] || param} (${P.unit}${P.logScale ? ", log" : ""})`)}</text>`;
    TPS.forEach((t, i) => {
      const x0 = m.l + i * cw, [lo, med, hi] = P.dpat[t];
      const top = cl(hi), bot = cl(lo);
      s += `<rect x="${x0 + cw * 0.08}" y="${top}" width="${cw * 0.84}" height="${Math.max(1, bot - top)}" rx="6" style="fill:var(--band)"><title>DPAT window ${fmt(lo)}–${fmt(hi)} ${P.unit}</title></rect>`;
      s += `<line x1="${x0 + cw * 0.08}" x2="${x0 + cw * 0.92}" y1="${y(med)}" y2="${y(med)}" style="stroke:var(--accent)" stroke-width="1.5" opacity=".6"/>`;
      s += `<text x="${x0 + cw / 2}" y="${H - 12}" text-anchor="middle" style="fill:var(--text)">${t}</text>`;
    });
    if (specOn) {
      s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(P.specMax)}" y2="${y(P.specMax)}" style="stroke:var(--text)" stroke-width="1.4" stroke-dasharray="5 4"/>` +
        `<text x="${w - m.r - 4}" y="${y(P.specMax) - 6}" text-anchor="end" style="fill:var(--text)">datasheet max ${fmt(P.specMax)} ${esc(P.unit)}</text>`;
    } else if (P.specMax != null) {
      s += `<text x="${w - m.r - 4}" y="${m.t + 10}" text-anchor="end">datasheet max ${fmt(P.specMax)} ${esc(P.unit)} ↑ (off scale)</text>`;
    }
    const sorted = [...parts].sort((a, b) => DEC_ORDER[b.dec] - DEC_ORDER[a.dec]);
    const sel = parts.find((p) => p.id === selId);
    const px = (p, i) => m.l + i * cw + cw / 2 + (hash01(p.id) - 0.5) * cw * 0.62;
    for (const p of sorted) {
      const r = p.dec === "ACCEPT" ? 2.4 : 3.8;
      const tip = `${p.id} · ${p.dec}${p.type ? " · " + (TYPE_LABEL[p.type.split(",")[0]] || p.type) : ""}`;
      p.p[param].v.forEach((v, i) => {
        s += `<circle class="dot-part d-${p.dec}" data-id="${esc(p.id)}" data-tip="${esc(`${tip} · ${TPS[i]}: ${fmt(v)} ${P.unit}`)}" cx="${px(p, i).toFixed(1)}" cy="${cl(v).toFixed(1)}" r="${r}" opacity="${p.dec === "ACCEPT" ? 0.7 : 0.95}"/>`;
      });
    }
    if (sel) {
      const pts = sel.p[param].v.map((v, i) => `${px(sel, i).toFixed(1)},${cl(v).toFixed(1)}`);
      s += `<polyline points="${pts.join(" ")}" fill="none" style="stroke:var(--text)" stroke-width="1.5" opacity=".7"/>`;
      sel.p[param].v.forEach((v, i) => {
        s += `<circle class="dot-part sel d-${sel.dec}" data-id="${esc(sel.id)}" cx="${px(sel, i).toFixed(1)}" cy="${cl(v).toFixed(1)}" r="5.5"/>`;
      });
    }
    return s + "</svg>";
  };
}

// ---------------------------------------------------------------- drill-down charts
function trajectoryChart(lot, param, part) {
  const P = lot.params[param], b = part.p[param];
  return (w) => {
    const H = 260, m = { l: 54, r: 58, t: 14, b: 32 };
    const env = P.envelope;
    const [pred, plo, phi] = b.pred;
    const core = [...b.v, ...env["5"], ...env["95"], pred, plo, phi].filter(Number.isFinite);
    const vmin = Math.min(...core), vmax = Math.max(...core);
    const inc = [];
    if (P.specMax != null && P.specMax <= vmax * 2.5) inc.push(P.specMax);
    const [d0, d1] = extent(core, { logScale: P.logScale, include: inc, pad: 0.08 });
    const y = (P.logScale ? log : linear)(d0, d1, H - m.b, m.t);
    const x = linear(0, 168, m.l, w - m.r);
    const cl = (v) => Math.min(H - m.b, Math.max(m.t, y(v)));
    const col = `var(--${part.dec === "ACCEPT" ? "muted" : part.dec.toLowerCase()})`;
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(`${part.id} ${param} trajectory versus lot envelope`)}">`;
    for (const t of y.ticks(5))
      s += `<line class="grid-line" x1="${m.l}" x2="${w - m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l - 8}" y="${y(t)}" text-anchor="end" dominant-baseline="middle">${fmt(t)}</text>`;
    T_HOURS.forEach((t) => { s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${t} h</text>`; });
    const up = T_HOURS.map((t, i) => `${x(t)},${cl(env["95"][i])}`), dn = T_HOURS.map((t, i) => `${x(t)},${cl(env["5"][i])}`).reverse();
    s += `<polygon points="${[...up, ...dn].join(" ")}" style="fill:var(--envelope)"/>`;
    s += `<polyline points="${T_HOURS.map((t, i) => `${x(t)},${cl(env["50"][i])}`).join(" ")}" fill="none" style="stroke:var(--muted)" stroke-dasharray="4 4" stroke-width="1.4"/>`;
    const dpHi = TPS.map((t) => P.dpat[t][2]);
    if (dpHi.every((v) => v <= d1 && v >= d0))
      s += `<polyline points="${T_HOURS.map((t, i) => `${x(t)},${y(dpHi[i])}`).join(" ")}" fill="none" style="stroke:var(--accent)" stroke-dasharray="1.5 3" stroke-width="1.5"/>`;
    if (inc.length)
      s += `<line x1="${m.l}" x2="${w - m.r}" y1="${y(P.specMax)}" y2="${y(P.specMax)}" style="stroke:var(--text)" stroke-dasharray="5 4" stroke-width="1.3"/><text x="${m.l + 4}" y="${y(P.specMax) - 5}" style="fill:var(--text)">datasheet max ${fmt(P.specMax)}</text>`;
    // forecast from 24 h
    const fx = x(168) + 14;
    s += `<line x1="${x(24)}" y1="${cl(b.v[1])}" x2="${fx}" y2="${cl(pred)}" style="stroke:var(--accent)" stroke-dasharray="3 3" stroke-width="1.4"/>`;
    s += `<line x1="${fx}" x2="${fx}" y1="${cl(phi)}" y2="${cl(plo)}" style="stroke:var(--accent)" stroke-width="2"/>`;
    for (const v of [plo, phi]) s += `<line x1="${fx - 4}" x2="${fx + 4}" y1="${cl(v)}" y2="${cl(v)}" style="stroke:var(--accent)" stroke-width="2"/>`;
    s += `<rect x="${fx - 4.5}" y="${cl(pred) - 4.5}" width="9" height="9" transform="rotate(45 ${fx} ${cl(pred)})" style="fill:var(--accent)" data-tip="Forecast 168 h: ${fmt(pred)} (band ${fmt(plo)}–${fmt(phi)}) ${P.unit}"/>`;
    s += `<text x="${fx + 8}" y="${cl(pred)}" dominant-baseline="middle" style="fill:var(--accent)">forecast</text>`;
    s += `<polyline points="${T_HOURS.map((t, i) => `${x(t)},${cl(b.v[i])}`).join(" ")}" fill="none" style="stroke:${col}" stroke-width="2.2"/>`;
    b.v.forEach((v, i) => { s += `<circle cx="${x(T_HOURS[i])}" cy="${cl(v)}" r="4" style="fill:${col}" data-tip="${TPS[i]}: ${fmt(v)} ${P.unit}"/>`; });
    return s + "</svg>";
  };
}

function barRows(items, { diverging = false, fmtV = (v) => fmt(v, 3) } = {}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value ?? 0)), 1e-12);
  return `<div class="bars">${items.map((i) => {
    const v = i.value;
    let fill = "";
    if (Number.isFinite(v)) {
      const f = Math.abs(v) / max;
      fill = diverging
        ? `<div class="bar-fill ${v < 0 ? "neg" : ""}" style="${v < 0 ? `right:50%;width:${f * 50}%` : `left:50%;width:${f * 50}%`}"></div>`
        : `<div class="bar-fill ${i.cls || ""}" style="left:0;width:${Math.max(1, f * 100)}%"></div>`;
    }
    return `<div class="bar-row ${i.binding ? "binding" : ""}"><span class="lbl" title="${esc(i.label)}">${esc(i.label)}</span>
      <div class="bar-track ${diverging ? "div" : ""}">${fill}</div><span class="val">${i.text ?? fmtV(v)}</span></div>`;
  }).join("")}</div>`;
}

function slopeSection(lot, param, part, limitNames) {
  const P = lot.params[param], sl = part.p[param].slope, u = `${P.unit}/h`;
  const down = sl.dir === "down";
  const mag = (v) => (v === null ? null : Math.abs(v));
  const limits = [["spec", "Spec delta / 168 h"], ["lot", "Lot robust slope"], ["mission", "Mission life (Arrhenius)"]];
  const exceeds = down ? sl.bound < sl.safe : sl.bound > sl.safe;
  const items = [{ label: `Forecast ${down ? "lower" : "upper"}-bound slope`, value: mag(sl.bound), cls: exceeds ? "bad" : "", text: signed(sl.bound, 3) }]
    .concat(limits.map(([k, l]) => ({
      label: l + (sl.bind === k ? " · binding" : ""), value: mag(sl[k]), binding: sl.bind === k, cls: "neg",
      text: sl[k] === null ? "no limit" : signed(sl[k], 3),
    })));
  const ratio = sl.safe ? sl.bound / sl.safe : null;
  return `${barRows(items)}
    <p class="small muted" style="margin-top:10px">Safety slope = ${down ? "max" : "min"} of the three limits = <b class="mono">${signed(sl.safe, 3)} ${esc(u)}</b>, bound by the
    <b>${esc(limitNames[sl.bind] || sl.bind)}</b>. The ${down ? "lower" : "upper"}-bound forecast slope is
    <b style="color:var(--${exceeds ? "reject" : "ok"})">${exceeds ? "beyond" : "within"}</b> it${Number.isFinite(ratio) && ratio > 0 ? ` (${ratio.toFixed(1)}×)` : ""}.${down ? " Drift is downward (two-sided parameter)." : ""}</p>`;
}

function formatExplanation(text) {
  if (!text) return "";
  const hl = (s) => esc(s)
    .replace(/\b(EXCEEDED|DELTA FAIL|EXCEEDS)\b/g, "<mark>$1</mark>")
    .replace(/(within delta limit|→ within)/g, '<mark class="ok">$1</mark>')
    .replace(/(binding limit: )([^→]+)/g, "$1<strong>$2</strong>")
    .replace(/ (Drift \(Module B)/g, "</p><p>$1")
    .replace(/^(Iddq|Leakage|Prop_Delay|[A-Za-z_]+):/, '<span class="param-name">$1</span>');
  const segs = text.split(" | ");
  const m = segs[0].match(/^(Component [\s\S]*?\)\.)\s+([\s\S]*)$/);
  let head = "";
  if (m) { head = m[1]; segs[0] = m[2]; }
  return (head ? `<p><strong>${esc(head)}</strong></p>` : "") + segs.map((s) => `<p>${hl(s)}</p>`).join("");
}

function acceptText(part, tau) {
  return `<p><strong>Component ${esc(part.id)} ACCEPT.</strong> No datasheet or delta-limit failure. Module A lot-outlier score ${fmt(part.A)} vs τA = ${fmt(tau.A)}; Module B drift score ${fmt(part.B)} vs τB = ${fmt(tau.B)}. The combined score is ${fmt(part.C)}× threshold, below the ${tau.reviewFrac}× review band, so no explanation or SHAP breakdown was generated.</p>`;
}

function drawerHTML(d, lot, part, param) {
  const b = part.p[param], P = lot.params[param];
  const params = Object.keys(part.p);
  const truth = part.y ? `Injected defect: ${esc(typeLabel(part.type))}` : "Good part (no injected defect)";
  const shapA = b.shapA.map(([l, v]) => ({ label: l, value: v }));
  const shapB = b.shapB.map(([l, v]) => ({ label: l, value: v }));
  const zStr = (v) => (v === null ? "—" : v.toFixed(1));
  return `
  <div class="drawer-head">
    <div class="row"><h3 style="margin:0" id="drawer-title">${esc(part.id)}</h3>${badge(part.dec)}<span class="spacer"></span>
      <button class="close-btn" type="button" aria-label="Close">×</button></div>
    <div class="row small" style="margin-top:8px;gap:8px"><span class="muted">Lot ${esc(lot.id)} · ${truth}</span>${outcome(part)}</div>
  </div>
  <div class="drawer-body">
    <div class="meta-grid">
      <div><div class="k">Module A</div><div class="v">${fmt(part.A)}</div><div class="small muted">τA ${fmt(d.tau.A)}</div></div>
      <div><div class="k">Module B</div><div class="v">${fmt(part.B)}</div><div class="small muted">τB ${fmt(d.tau.B)}</div></div>
      <div><div class="k">Combined</div><div class="v">${part.rule ? "rule fail" : `${fmt(part.C)}×`}</div><div class="small muted">reject ≥ 1, review ≥ ${d.tau.reviewFrac}</div></div>
      <div><div class="k">Rules</div><div class="v" style="color:var(--${part.rule ? "reject" : "ok"})">${part.rule ? "FAIL" : "pass"}</div><div class="small muted">datasheet + delta</div></div>
    </div>

    <h4>Parameter</h4>
    <div class="seg" role="group" aria-label="Parameter">${params.map((p) => `<button type="button" data-param="${esc(p)}" aria-pressed="${p === param}">${esc(PARAM_LABEL[p] || p)}${part.primary === p ? " ★" : ""}</button>`).join("")}</div>

    <h4>Trajectory vs lot envelope</h4>
    <div class="legend"><span><i class="box" style="background:var(--envelope)"></i>lot 5–95%</span><span><i style="background:repeating-linear-gradient(90deg,var(--muted) 0 4px,transparent 4px 7px)"></i>lot median</span><span><i style="background:repeating-linear-gradient(90deg,var(--accent) 0 2px,transparent 2px 5px)"></i>DPAT upper</span><span><i class="dot" style="background:var(--accent)"></i>forecast 168 h (${Math.round(d.metricsPi * 100)}% band)</span></div>
    <div class="chart" id="traj"></div>
    <div class="table-wrap" style="margin-top:12px"><table>
      <thead><tr><th></th>${TPS.map((t) => `<th class="num">${t}</th>`).join("")}</tr></thead>
      <tbody>
        <tr><td>Reading (${esc(P.unit)})</td>${b.v.map((v) => `<td class="num">${fmt(v, 4)}</td>`).join("")}</tr>
        <tr><td>DPAT window</td>${TPS.map((t) => `<td class="num">${fmt(P.dpat[t][0])}–${fmt(P.dpat[t][2])}</td>`).join("")}</tr>
      </tbody></table></div>
    <p class="small muted" style="margin-top:8px">Max |robust z| ${zStr(b.z)} (DPAT k = ${d.dpatK}) · largest Δ vs 0 h ${signed(b.dWorst)} ${esc(P.unit)} at ${esc(b.dWorstT)} vs allowed ±${fmt(b.dAllow)} ${b.delta ? '<span class="chip bad">DELTA FAIL</span>' : ""}${b.spec ? ' <span class="chip bad">SPEC FAIL</span>' : ""} · forecast 168 h ${fmt(b.pred[0])} (${fmt(b.pred[1])}–${fmt(b.pred[2])}), actual ${fmt(b.v[3])}</p>

    <h4>Safety-slope check (Module B, 0 h + 24 h only)</h4>
    ${slopeSection(lot, param, part, d.limitNames)}

    <h4>SHAP contributions</h4>
    ${shapA.length || shapB.length ? `
      <div class="small muted" style="margin-bottom:6px">Module A · Isolation Forest (positive = more anomalous)</div>
      ${shapA.length ? barRows(shapA, { diverging: true }) : '<p class="small faint">—</p>'}
      <div class="small muted" style="margin:14px 0 6px">Module B · forecast of log(V168/V0)</div>
      ${shapB.length ? barRows(shapB, { diverging: true }) : '<p class="small faint">—</p>'}`
      : `<p class="small muted">SHAP values are computed only for flagged (REVIEW / REJECT) parts.</p>`}

    <h4>Reason codes</h4>
    <div>${part.codes.length ? part.codes.map((c) => `<span class="chip ${codeClass(c)}" title="${esc(codeHelp(c))}">${esc(c)}</span>`).join("") : '<span class="small muted">none</span>'}</div>
    ${part.codes.length ? `<ul class="small muted" style="margin:8px 0 0;padding-left:1.1em">${[...new Set(part.codes.map(codeHelp))].map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}

    <h4>QA inspector card</h4>
    <div class="inspector">
      <div class="inspector-head"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>Justification · generated by the decision engine</div>
      <div class="inspector-body">${part.text ? formatExplanation(part.text) : acceptText(part, d.tau)}</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- page
export async function render(app, params) {
  const [d, metrics] = await Promise.all([loadJSON("data/lots.json"), loadJSON("data/metrics.json")]);
  d.metricsPi = metrics.piQuantile;
  const lotsById = Object.fromEntries(d.lots.map((l) => [l.id, l]));
  const byLot = {};
  for (const p of d.parts) (byLot[p.lot] ||= []).push(p);
  const types = [...new Set(d.parts.map((p) => p.type).filter(Boolean))].sort();

  const st = {
    lot: lotsById[params.get("lot")] ? params.get("lot") : "L15",
    param: params.get("param") || "Iddq",
    q: "", dec: "flagged", truth: "all", page: 0,
    part: params.get("part"),
  };
  if (!lotsById[st.lot].params[st.param]) st.param = Object.keys(lotsById[st.lot].params)[0];

  const splitLabel = { test: "held-out test", val: "validation", train: "training (in-sample)" };
  app.innerHTML = `
  <section class="wrap section-tight">
    <span class="eyebrow">Explorer</span>
    <h1 style="font-size:clamp(1.8rem,3.5vw,2.4rem)">Every part, every decision</h1>
    <p class="lead">Pick a lot and parameter. Each dot is one part at one timepoint; the shaded band is that lot's DPAT window. Click any dot or table row to open the part.</p>
    <div class="toolbar" style="margin-top:22px">
      <label class="field">Lot<select id="lot">${d.lots.map((l) => `<option value="${l.id}">${l.id} · ${l.nParts} parts · ${splitLabel[l.split] || l.split}</option>`).join("")}</select></label>
      <label class="field">Parameter<select id="param"></select></label>
    </div>
    <div class="lot-summary" id="lot-summary"></div>
    <div class="card" style="padding:14px 16px 8px">
      <div class="legend"><span><i class="dot" style="background:var(--accept)"></i>ACCEPT</span><span><i class="dot" style="background:var(--review)"></i>REVIEW</span><span><i class="dot" style="background:var(--reject)"></i>REJECT</span><span><i class="box" style="background:var(--band)"></i>DPAT window (k = ${d.dpatK})</span><span><i style="background:repeating-linear-gradient(90deg,var(--text) 0 5px,transparent 5px 9px)"></i>datasheet max</span></div>
      <div class="chart" id="strip"></div>
    </div>
  </section>
  <section class="wrap section-tight" style="padding-top:8px">
    <div class="toolbar">
      <label class="field" style="flex:1;min-width:200px">Search<input id="q" type="search" placeholder="Component ID, reason code or text…"></label>
      <label class="field">Decision<select id="dec"><option value="flagged">REJECT + REVIEW</option><option value="all">All</option><option>REJECT</option><option>REVIEW</option><option>ACCEPT</option></select></label>
      <label class="field">Ground truth<select id="truth"><option value="all">All</option><option value="defective">Defective</option><option value="good">Good</option>${types.map((t) => `<option value="t:${t}">${esc(TYPE_LABEL[t] || t)}</option>`).join("")}<option value="escape">Escapes</option><option value="fp">False rejects</option></select></label>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Component</th><th>Decision</th><th>Ground truth</th><th class="num">A</th><th class="num">B</th><th class="num">Combined</th><th>Primary</th><th>Reason codes</th></tr></thead>
      <tbody id="tbody"></tbody></table></div>
    <div class="pager" id="pager"></div>
  </section>
  <div class="drawer-backdrop" id="backdrop"></div>
  <aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-hidden="true"></aside>`;

  const $ = (s) => app.querySelector(s);
  const stripEl = $("#strip"), drawer = $("#drawer"), backdrop = $("#backdrop");
  tooltips(stripEl);
  let strip = null, traj = null, lastFocus = null;

  const lotParts = () => byLot[st.lot] || [];
  function drawStrip() {
    strip?.disconnect();
    strip = mount(stripEl, stripPlot(lotsById[st.lot], st.param, lotParts(), st.part));
  }
  function renderLotMeta() {
    const lot = lotsById[st.lot];
    $("#param").innerHTML = Object.keys(lot.params).map((p) => `<option value="${p}" ${p === st.param ? "selected" : ""}>${PARAM_LABEL[p] || p} (${lot.params[p].unit})</option>`).join("");
    const parts = lotParts();
    const tp = parts.filter((p) => p.y && p.dec === "REJECT").length;
    const P = lot.params[st.param];
    $("#lot-summary").innerHTML = `<span><b>${lot.nParts}</b> parts</span><span><b>${lot.nDefective}</b> injected defects</span>
      <span><b style="color:var(--reject)">${lot.decisions.REJECT}</b> reject</span><span><b style="color:var(--review)">${lot.decisions.REVIEW}</b> review</span>
      <span><b>${tp}/${lot.nDefective}</b> defects rejected</span><span>168 h DPAT window <b class="mono">${fmt(P.dpat["168h"][0])}–${fmt(P.dpat["168h"][2])} ${esc(P.unit)}</b></span>`;
  }

  function filtered() {
    const q = st.q.trim().toLowerCase();
    return lotParts().filter((p) => {
      if (st.dec === "flagged" && p.dec === "ACCEPT") return false;
      if (!["flagged", "all"].includes(st.dec) && p.dec !== st.dec) return false;
      if (st.truth === "defective" && !p.y) return false;
      if (st.truth === "good" && p.y) return false;
      if (st.truth.startsWith("t:") && !p.type.split(",").includes(st.truth.slice(2))) return false;
      if (st.truth === "escape" && !(p.y && p.dec !== "REJECT")) return false;
      if (st.truth === "fp" && !(!p.y && p.dec === "REJECT")) return false;
      if (q && !(p.id.toLowerCase().includes(q) || p.codes.join(" ").toLowerCase().includes(q) || p.text.toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => DEC_ORDER[a.dec] - DEC_ORDER[b.dec] || b.C - a.C);
  }
  function renderTable() {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    st.page = Math.min(st.page, pages - 1);
    const view = rows.slice(st.page * PAGE_SIZE, (st.page + 1) * PAGE_SIZE);
    $("#tbody").innerHTML = view.length ? view.map((p) => `
      <tr class="clickable ${p.id === st.part ? "hl" : ""}" data-id="${esc(p.id)}" tabindex="0">
        <td class="mono">${esc(p.id)}</td><td>${badge(p.dec)}</td>
        <td>${p.y ? `<span style="color:var(--reject)">${esc(typeLabel(p.type))}</span>` : '<span class="muted">good</span>'}</td>
        <td class="num">${fmt(p.A)}</td><td class="num">${fmt(p.B)}</td><td class="num">${p.rule ? "rule" : fmt(p.C)}</td>
        <td>${esc(PARAM_LABEL[p.primary] || p.primary || "—")}</td>
        <td>${p.codes.slice(0, 3).map((c) => `<span class="chip ${codeClass(c)}">${esc(c)}</span>`).join("")}${p.codes.length > 3 ? `<span class="faint small">+${p.codes.length - 3}</span>` : ""}</td>
      </tr>`).join("") : `<tr><td colspan="8" class="muted">No parts match these filters.</td></tr>`;
    $("#pager").innerHTML = `<span>${rows.length} part${rows.length === 1 ? "" : "s"}</span>` + (pages > 1 ? `
      <button class="btn" data-pg="-1" ${st.page === 0 ? "disabled" : ""}>Prev</button><span>${st.page + 1} / ${pages}</span>
      <button class="btn" data-pg="1" ${st.page >= pages - 1 ? "disabled" : ""}>Next</button>` : "");
  }

  function openPart(id, param) {
    const part = d.parts.find((p) => p.id === id);
    if (!part) return;
    if (part.lot !== st.lot) { st.lot = part.lot; $("#lot").value = st.lot; renderLotMeta(); }
    st.part = id;
    const lot = lotsById[part.lot];
    const prm = param || (part.p[st.param] ? st.param : part.primary) || Object.keys(part.p)[0];
    if (!drawer.classList.contains("open")) lastFocus = document.activeElement;
    drawer.innerHTML = drawerHTML(d, lot, part, prm);
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.classList.add("open");
    traj?.disconnect();
    const trajEl = drawer.querySelector("#traj");
    tooltips(trajEl);
    traj = mount(trajEl, trajectoryChart(lot, prm, part));
    drawer.querySelector(".close-btn").focus({ preventScroll: true });
    setQuery({ lot: st.lot, param: st.param, part: id });
    drawStrip();
    renderTable();
  }
  function closePart() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.classList.remove("open");
    st.part = null;
    setQuery({ part: null });
    drawStrip();
    renderTable();
    lastFocus?.focus?.({ preventScroll: true });
  }

  $("#lot").value = st.lot;
  $("#lot").addEventListener("change", (e) => {
    st.lot = e.target.value; st.page = 0; st.part = null;
    if (!lotsById[st.lot].params[st.param]) st.param = Object.keys(lotsById[st.lot].params)[0];
    setQuery({ lot: st.lot, param: st.param, part: null });
    renderLotMeta(); drawStrip(); renderTable();
  });
  $("#param").addEventListener("change", (e) => { st.param = e.target.value; setQuery({ param: st.param }); renderLotMeta(); drawStrip(); });
  $("#q").addEventListener("input", (e) => { st.q = e.target.value; st.page = 0; renderTable(); });
  $("#dec").addEventListener("change", (e) => { st.dec = e.target.value; st.page = 0; renderTable(); });
  $("#truth").addEventListener("change", (e) => { st.truth = e.target.value; st.page = 0; renderTable(); });
  $("#pager").addEventListener("click", (e) => { const b = e.target.closest("[data-pg]"); if (b) { st.page += Number(b.dataset.pg); renderTable(); } });
  stripEl.addEventListener("click", (e) => { const c = e.target.closest("[data-id]"); if (c) openPart(c.dataset.id); });
  $("#tbody").addEventListener("click", (e) => { const r = e.target.closest("tr[data-id]"); if (r) openPart(r.dataset.id); });
  $("#tbody").addEventListener("keydown", (e) => { const r = e.target.closest("tr[data-id]"); if (r && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openPart(r.dataset.id); } });
  backdrop.addEventListener("click", closePart);
  drawer.addEventListener("click", (e) => {
    if (e.target.closest(".close-btn")) closePart();
    const pb = e.target.closest("[data-param]");
    if (pb) openPart(st.part, pb.dataset.param);
  });
  const onKey = (e) => { if (e.key === "Escape" && drawer.classList.contains("open")) closePart(); };
  document.addEventListener("keydown", onKey);

  renderLotMeta();
  drawStrip();
  renderTable();
  if (st.part) openPart(st.part);

  return () => { strip?.disconnect(); traj?.disconnect(); document.removeEventListener("keydown", onKey); };
}
