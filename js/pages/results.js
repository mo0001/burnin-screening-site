import { esc, fmt, loadJSON, pct, TYPE_LABEL } from "../util.js";
import { legend, lineChart, mount, tooltips } from "../svg.js";

const SYSTEMS = [
  ["rules_only", "Static rules (datasheet + delta)"],
  ["module_b_early_24h", "Module B early flag at 24 h"],
  ["module_a", "Rules + Module A"],
  ["combined_reject_only", "Combined · REJECT"],
  ["combined_reject_or_review", "Combined · REJECT + REVIEW"],
];
const MODEL_LABEL = { physics: "Physics power law", hybrid: "Hybrid (physics + XGBoost residual)", xgboost: "XGBoost", ridge: "Ridge", naive: "Naive linear extrapolation" };
const C = { accent: "var(--accent)", reject: "var(--reject)", review: "var(--review)", muted: "var(--muted)", faint: "var(--faint)", ok: "var(--ok)" };

function confusion(title, r, note) {
  const cm = r.confusion_matrix;
  return `<div class="card">
    <h3>${esc(title)}</h3><p class="small muted">${esc(note)}</p>
    <div class="cm" role="table" aria-label="${esc(title)} confusion matrix">
      <div></div><div class="h">Predicted reject</div><div class="h">Predicted pass</div>
      <div class="h side">Defective</div><div class="c tp">${cm.tp}<small>caught</small></div><div class="c fn">${cm.fn}<small>escapes</small></div>
      <div class="h side">Good</div><div class="c fp">${cm.fp}<small>false rejects</small></div><div class="c tn">${cm.tn}<small>accepted</small></div>
    </div>
    <div class="cm-stats"><span>Recall <b>${pct(r.recall)}</b></span><span>Precision <b>${pct(r.precision)}</b></span><span>F2 <b>${fmt(r.f2)}</b></span><span>Overkill <b>${pct(r.overkill_rate, 2)}</b></span></div>
  </div>`;
}

export async function render(app) {
  const m = await loadJSON("data/metrics.json");
  const R = m.reports, cfg = m.config;
  const comb = R.combined_reject_only;
  const models = Object.keys(m.mae);
  const params = Object.keys(m.mae[models[0]].perParam);
  const units = { Iddq: "µA", Leakage: "µA", Prop_Delay: "ns" };
  const best = Object.fromEntries(params.map((p) => [p, Math.min(...models.map((k) => m.mae[k].perParam[p]))]));
  const maxN = Math.max(...models.map((k) => m.mae[k].nmae));
  const rd = m.realData;
  const rdParams = rd ? Object.keys(rd.mae[Object.keys(rd.mae)[0]]) : [];
  const chosen = m.costThresholdCurve.find((p) => Math.abs(p.t - 1) < 1e-6);
  const minCost = m.costThresholdCurve.reduce((a, b) => (b.cost < a.cost ? b : a));
  const typeRows = Object.entries(m.recallByType);

  app.innerHTML = `
  <section class="wrap section-tight">
    <span class="eyebrow">Results</span>
    <h1 style="font-size:clamp(1.8rem,3.5vw,2.4rem)">Held-out evaluation</h1>
    <p class="lead">Test lots ${m.testLots.join(", ")}: ${comb.n} components, ${comb.n_defective} with injected latent defects. Thresholds were tuned on validation lots (${m.valLots.join(", ")}) and never saw these parts.</p>
  </section>

  <section class="wrap section-tight">
    <h2>Static limits vs the AI system</h2>
    <div class="grid g3" style="margin-top:18px">
      ${confusion("Static rules", R.rules_only, "Datasheet max + MIL-STD-883 style delta limits")}
      ${confusion("Rules + Module A", R.module_a, "Adds lot-relative outlier detection")}
      ${confusion("Combined system", comb, "Rules + Module A + Module B, REJECT only")}
    </div>
    <div class="table-wrap" style="margin-top:22px"><table>
      <thead><tr><th>System</th><th class="num">Recall</th><th class="num">Precision</th><th class="num">F2</th><th class="num">Overkill</th><th class="num">Escapes</th><th class="num">Escape-rate 95% UB</th><th class="num">Cost (${cfg.costFN}·FN + ${cfg.costFP}·FP)</th></tr></thead>
      <tbody>${SYSTEMS.map(([k, l]) => { const r = R[k]; return `<tr class="${k === "combined_reject_only" ? "best" : ""}"><td>${l}</td><td class="num">${pct(r.recall)}</td><td class="num">${pct(r.precision)}</td><td class="num">${fmt(r.f2)}</td><td class="num">${pct(r.overkill_rate, 2)}</td><td class="num">${r.escapes}</td><td class="num">${pct(r.escape_rate_ub95)}</td><td class="num">${fmt(r.cost, 4)}</td></tr>`; }).join("")}</tbody>
    </table></div>
    <p class="small muted" style="margin-top:10px">Escape-rate upper bound is the one-sided 95% Clopper–Pearson bound on escapes / defective parts. With only ${comb.n_defective} defects, even ${comb.escapes} escapes leave a wide interval.</p>
  </section>

  <section class="wrap section-tight">
    <h2>Recall by defect type</h2>
    <div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Defect type</th><th class="num">n</th><th class="num">Static rules</th><th class="num">Rules + A</th><th class="num">B at 24 h</th><th class="num">Combined</th></tr></thead>
      <tbody>${typeRows.map(([t, v]) => `<tr><td>${esc(TYPE_LABEL[t] || t)}</td><td class="num">${v.n}</td><td class="num">${pct(v.rules, 0)}</td><td class="num">${pct(v.module_a, 0)}</td><td class="num">${pct(v.module_b_24h, 0)}</td><td class="num"><b>${pct(v.combined_reject, 0)}</b></td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  <section class="wrap section-tight">
    <div class="grid g2">
      <div class="card">
        <h3>Recall and overkill vs DPAT k</h3>
        <p class="small muted">Rules + DPAT alone (no learned models) vs the full Module A. k ≈ 4–4.5 is the knee for DPAT; Module A keeps its recall at every k.</p>
        ${legend([{ name: "DPAT recall", color: C.accent }, { name: "DPAT overkill", color: C.review }, { name: "Module A recall", color: C.accent, dash: true }, { name: "Module A overkill", color: C.review, dash: true }])}
        <div class="chart" id="kcurve"></div>
      </div>
      <div class="card">
        <h3>Cost vs decision threshold</h3>
        <p class="small muted">Test-lot cost = ${cfg.costFN}·escapes + ${cfg.costFP}·false rejects as the combined-score threshold moves. τ = 1 is the point tuned on validation lots (cost ${chosen ? chosen.cost : "—"}); the test-set minimum is ${minCost.cost} at τ = ${minCost.t}.</p>
        ${legend([{ name: "Total cost", color: C.accent }, { name: `Escapes × ${cfg.costFN}`, color: C.reject }, { name: "False rejects", color: C.review }])}
        <div class="chart" id="costcurve"></div>
      </div>
    </div>
    <div class="card" style="margin-top:20px">
      <h3>Choosing the cost ratio C<sub>FN</sub> : C<sub>FP</sub></h3>
      <p class="small muted">Thresholds re-tuned on validation lots for each ratio, then applied to the test lots. The chosen ${cfg.costFN}:${cfg.costFP} sits before the overkill cliff.</p>
      ${legend([{ name: "Recall", color: C.accent }, { name: "Overkill", color: C.review }])}
      <div class="chart" id="ratiocurve"></div>
    </div>
  </section>

  <section class="wrap section-tight">
    <h2>Module B: forecasting the 168 h value from 0 h + 24 h</h2>
    <p class="muted" style="max-width:48rem">Mean absolute error on the test lots. The default model (${esc(MODEL_LABEL[m.maeDefault])}) was selected on validation-lot normalised MAE. Learned power-law exponents: ${Object.entries(m.powerLawN).map(([p, n]) => `${p} n = ${n}`).join(", ")}. The conformal ${Math.round(m.piQuantile * 100)}% upper bound covers ${pct(m.piCoverageUpper)} of test rows.</p>
    <div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Model</th>${params.map((p) => `<th class="num">${p} (${units[p] || ""})</th>`).join("")}<th>Normalised MAE</th></tr></thead>
      <tbody>${models.map((k) => `<tr class="${k === m.maeDefault ? "hl" : ""}"><td>${esc(MODEL_LABEL[k] || k)}${k === m.maeDefault ? ' <span class="chip info">default</span>' : ""}</td>
        ${params.map((p) => `<td class="num" ${m.mae[k].perParam[p] === best[p] ? 'style="font-weight:700"' : ""}>${fmt(m.mae[k].perParam[p])}</td>`).join("")}
        <td><span class="inline-bar ${k === "naive" ? "naive" : ""}" style="width:${(m.mae[k].nmae / maxN) * 140}px"></span><span class="mono small">${m.mae[k].nmae.toFixed(2)}%</span></td></tr>`).join("")}</tbody>
    </table></div>
  </section>

  ${rd ? `<section class="wrap section-tight">
    <h2>Real-data validation (Module B)</h2>
    <p class="muted" style="max-width:48rem">Leave-one-lot-out on public degradation data: ${esc(rd.source)}. Each stress group is treated as a lot (${rd.nLots} lots) and the time axis is rescaled to the four checkpoints. Only aggregate MAE is shown here.</p>
    <div class="table-wrap" style="margin-top:14px"><table>
      <thead><tr><th>Model</th>${rdParams.map((p) => `<th class="num">${esc(p.replace("_", " "))} <span class="faint">(${rd.units[p]} units)</span></th>`).join("")}</tr></thead>
      <tbody>${Object.keys(rd.mae).map((k) => { return `<tr><td>${esc(MODEL_LABEL[k] || k)}</td>${rdParams.map((p) => { const b = Math.min(...Object.values(rd.mae).map((x) => x[p])); return `<td class="num" ${rd.mae[k][p] === b ? 'style="font-weight:700"' : ""}>${fmt(rd.mae[k][p])}</td>`; }).join("")}</tr>`; }).join("")}</tbody>
    </table></div>
    <p class="small muted" style="margin-top:10px">The physics-informed hybrid beats pure XGBoost on all three datasets and is best on two of three; Ridge wins on DeviceB (34 units). Data: Meeker &amp; Escobar SMRD2 via Iowa State University, licensed CC BY 4.0.</p>
  </section>` : ""}

  <section class="wrap section-tight">
    <h2>Figures</h2>
    <div class="grid g2" style="margin-top:14px">
      ${[
        ["01_static_vs_dynamic_limits", "Static vs dynamic limits: a 45 µA part in a 10 µA lot passes the datasheet but sits far outside the lot's DPAT window (illustrative lot; inset counts test-lot cases)."],
        ["02_lot_to_lot_variation", "Lot medians shift by up to 2.8×, so one static limit is too loose for most lots."],
        ["03_trajectories_by_defect_type", "Each defect signature leaves the normal-lot envelope differently, mostly while still inside datasheet and delta limits."],
        ["04_drift_prediction_actual_vs_pred", "Module B predicted vs actual Value_168h on unseen lots."],
        ["06_safety_slope_early_rejection", "Upper-bound forecast slope vs safety slope: parts above the diagonal can be rejected at 24 h."],
        ["07_asymmetric_cost_threshold", "Asymmetric cost moves the threshold towards fewer escapes."],
        ["09_escapes_static_vs_ai", "Escapes by defect type, static limits vs the AI system."],
        ["11_shap_global", "Global SHAP: interval drifts dominate the Isolation Forest; observed 0→24 h drift dominates the forecast."],
        ["12_shap_waterfall_rejected_part", "QA inspector card for a rejected latent defect."],
        ["14_recall_overkill_tradeoffs", "Recall vs overkill trade-offs across DPAT k and cost ratio."],
      ].map(([f, cap]) => `<figure><a href="img/fig/${f}.png" target="_blank" rel="noopener"><img src="img/fig/${f}.png" alt="${esc(cap)}" loading="lazy"></a><figcaption>${esc(cap)}</figcaption></figure>`).join("")}
    </div>
  </section>

  <section class="wrap section">
    <h2>Limitations, stated plainly</h2>
    <ul class="limits" style="max-width:52rem">
      <li><b>Synthetic evaluation.</b> Detection metrics come from a deliberately hard synthetic generator (log-normal variation, lot shifts, tester glitches, six defect types). No public dataset has per-device burn-in trajectories with latent-defect labels.</li>
      <li><b>Small defect counts.</b> ${comb.n_defective} test defects give a 95% escape-rate upper bound of ${pct(comb.escape_rate_ub95)}. ppm-level claims would need thousands of labelled defects.</li>
      <li><b>Late bloomers.</b> Defects that appear only after 96 h near the noise floor are invisible at 24 h; both test escapes are of this type.</li>
      <li><b>Overkill.</b> About ${pct(comb.overkill_rate, 1)} at the ${cfg.costFN}:${cfg.costFP} cost ratio, mostly from the Mahalanobis detector on small lots and tester glitches. In practice, REVIEW parts would be re-tested.</li>
      <li><b>Real data covers Module B only.</b> The Iowa State data validates forecasting, not defect detection.</li>
      <li><b>Placeholder physics.</b> Ea = ${cfg.eaEv} eV, ${cfg.tFieldC} °C field temperature, ${cfg.missionYears}-year mission and delta limits are representative defaults, to be replaced by part-specific procurement values.</li>
    </ul>
  </section>`;

  const charts = [];
  const k = m.kCurve;
  const pctFmt = (v) => `${Math.round(v * 100)}%`;
  const kEl = app.querySelector("#kcurve");
  tooltips(kEl);
  charts.push(mount(kEl, lineChart([
    { name: "DPAT recall", color: C.accent, points: k.map((r) => [r.k, r.dpat_recall]) },
    { name: "DPAT overkill", color: C.review, points: k.map((r) => [r.k, r.dpat_overkill]) },
    { name: "Module A recall", color: C.accent, dash: "5 4", points: k.map((r) => [r.k, r.moduleA_recall]) },
    { name: "Module A overkill", color: C.review, dash: "5 4", points: k.map((r) => [r.k, r.moduleA_overkill]) },
  ], { xLabel: "DPAT k (robust σ)", xName: "k", yFmt: pctFmt, yDomain: [0, 1], xTicks: k.map((r) => r.k) })));

  const cc = m.costThresholdCurve;
  const cEl = app.querySelector("#costcurve");
  tooltips(cEl);
  charts.push(mount(cEl, lineChart([
    { name: "Total cost", color: C.accent, dots: false, width: 2.4, points: cc.map((p) => [p.t, p.cost]) },
    { name: "Escape cost", color: C.reject, dots: false, points: cc.map((p) => [p.t, p.fn * cfg.costFN]) },
    { name: "False rejects", color: C.review, dots: false, points: cc.map((p) => [p.t, p.fp]) },
  ], { xLabel: "Combined-score threshold τ (× tuned value)", xName: "τ", markers: [{ x: 1, label: "tuned τ = 1" }], yDomain: [0, Math.max(...cc.map((p) => p.cost)) * 1.05] })));

  const rc = m.costRatioCurve;
  const rEl = app.querySelector("#ratiocurve");
  tooltips(rEl);
  charts.push(mount(rEl, lineChart([
    { name: "Recall", color: C.accent, points: rc.map((r) => [r.cost_ratio, r.recall]) },
    { name: "Overkill", color: C.review, points: rc.map((r) => [r.cost_ratio, r.overkill]) },
  ], { height: 230, xLog: true, xLabel: "C_FN : C_FP (log scale)", xName: "ratio", xFmt: (v) => `${v}:1`, yFmt: pctFmt, yDomain: [0, 1], markers: [{ x: cfg.costFN, label: `chosen ${cfg.costFN}:1` }] })));

  return () => charts.forEach((c) => c.disconnect());
}
