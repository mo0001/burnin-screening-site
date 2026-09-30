import { loadJSON, pct } from "../util.js";
import { log, mount } from "../svg.js";

const ICONS = {
  a: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="14" cy="20" r="9" stroke-dasharray="2.5 2.5"/><circle cx="11" cy="18" r="1.3" fill="currentColor"/><circle cx="16" cy="22" r="1.3" fill="currentColor"/><circle cx="13" cy="24" r="1.3" fill="currentColor"/><circle cx="17" cy="16" r="1.3" fill="currentColor"/><circle cx="29" cy="8" r="2.2"/><path d="m22 13 4.5-3.5"/></svg>`,
  b: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 30h28M4 30V5"/><path d="M6 26c5-2 8-5 11-9"/><path d="M17 17c3-4 7-8 13-10" stroke-dasharray="2.5 2.5"/><path d="M6 12h26" opacity=".55"/><circle cx="17" cy="17" r="1.6" fill="currentColor"/></svg>`,
  d: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 5v26M10 31h16"/><path d="M6 11h24"/><path d="m6 11-4 9h8zM30 11l-4 9h8z"/><path d="M2 20a4 3 0 0 0 8 0M26 20a4 3 0 0 0 8 0"/></svg>`,
  e: `<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4h15l7 7v21H7z"/><path d="M22 4v7h7"/><path d="M12 17h12M12 22h12M12 27h7"/></svg>`,
};

// Deterministic pseudo-random normals for the hero lot.
function lotSample(n, seed = 7) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: n }, () => {
    const u = Math.max(rnd(), 1e-9), v = rnd();
    return [Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v), rnd()];
  });
}

const SIGMA_LOG = 0.173, K = 6, SUSPECT = 45, SPEC = 50;
const LOT = lotSample(70);

function heroChart(median) {
  return (w) => {
    const H = 150, m = { l: 14, r: 14, t: 22, b: 30 };
    const x = log(1, 150, m.l, w - m.r);
    const lo = median * Math.exp(-K * SIGMA_LOG), hi = median * Math.exp(K * SIGMA_LOG);
    const inside = SUSPECT <= hi;
    const cy = (j) => m.t + 18 + j * (H - m.t - m.b - 36);
    let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="Lot distribution with DPAT window and datasheet limit; suspect part at 45 microamps">`;
    s += `<rect x="${x(lo)}" y="${m.t}" width="${Math.max(1, x(Math.min(hi, 150)) - x(lo))}" height="${H - m.t - m.b}" rx="6" style="fill:var(--band)"/>`;
    s += `<text x="${x(median)}" y="${m.t - 7}" text-anchor="middle" style="fill:var(--accent);font-weight:600">DPAT window (lot median ± 6σ)</text>`;
    s += `<line x1="${x(SPEC)}" x2="${x(SPEC)}" y1="${m.t - 4}" y2="${H - m.b}" style="stroke:var(--text)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    s += `<text x="${x(SPEC) - 6}" y="${H - m.b - 6}" text-anchor="end" style="fill:var(--text)">datasheet max 50 µA</text>`;
    for (const [z, j] of LOT) {
      const v = median * Math.exp(z * SIGMA_LOG);
      s += `<circle cx="${x(v).toFixed(1)}" cy="${cy(j).toFixed(1)}" r="3" style="fill:var(--accept)" opacity=".85"/>`;
    }
    const px = x(SUSPECT), py = cy(0.45);
    const col = inside ? "var(--muted)" : "var(--reject)";
    if (!inside) s += `<circle class="pulse" cx="${px}" cy="${py}" r="6" style="fill:var(--reject)"/>`;
    s += `<circle cx="${px}" cy="${py}" r="6" style="fill:${col}"/>`;
    s += `<text x="${px}" y="${py - 11}" text-anchor="middle" style="fill:${col};font-weight:600">45 µA</text>`;
    for (const t of [1, 2, 5, 10, 20, 50, 100])
      s += `<text x="${x(t)}" y="${H - 10}" text-anchor="middle">${t}</text>`;
    s += `<text x="${w - m.r}" y="${H - 10}" text-anchor="end">µA (log)</text>`;
    return s + "</svg>";
  };
}

function kpi(value, label, sub, accent = false) {
  return `<div class="card kpi"><div class="kpi-value ${accent ? "accent" : ""}">${value}</div>
    <div class="kpi-label">${label}</div><div class="kpi-sub">${sub}</div></div>`;
}

export async function render(app) {
  const m = await loadJSON("data/metrics.json");
  const R = m.reports, comb = R.combined_reject_only, rules = R.rules_only;
  const def = m.mae[m.maeDefault], naive = m.mae.naive;

  app.innerHTML = `
  <section class="hero wrap">
    <div class="team"><strong>BurnTestr</strong> · Team CTRL + Win (Team ID 124241) · Smart India Hackathon · Problem Statement 26170 · ISRO</div>
    <h1>Catch latent defects in burn-in before they fly.</h1>
    <p class="tagline">Lot-aware burn-in screening that flags components likely to fail later.</p>
    <p class="lead">Every part is judged against its own lot and its own drift, not just the datasheet, and every decision comes with an explanation a QA inspector can audit.</p>
    <div class="row" style="margin-top:26px">
      <a class="btn btn-primary" href="#/explorer">Explore the test lots</a>
      <a class="btn" href="#/try">Try it on your CSV</a>
      <a class="btn" href="#/results">See the results</a>
    </div>

    <div class="hook">
      <div>
        <p class="hook-quote">A part at 45 µA in a 10 µA lot passes the 50 µA datasheet limit, <em>and we catch it.</em></p>
        <p class="muted">Static limits are set for the worst lot the vendor ever ships. Dynamic Part Average Testing (DPAT) sets limits from each lot's own robust statistics, so a part that is 8.7 σ away from its siblings is flagged even though it is inside spec. Drag the lot median to see when 45 µA stops being suspicious.</p>
      </div>
      <div class="card hook-visual">
        <div id="hero-chart" class="chart"></div>
        <label class="field" style="margin-top:6px">
          <span>Lot median: <output id="med-out" class="mono">10 µA</output></span>
          <input id="med" type="range" min="4" max="40" step="0.5" value="10" aria-label="Lot median in microamps">
        </label>
        <div class="hook-status" id="hook-status" aria-live="polite"></div>
      </div>
    </div>
  </section>

  <section class="section wrap">
    <span class="eyebrow">Held-out results</span>
    <h2>Four numbers from ${comb.n} unseen parts in ${m.testLots.length} test lots</h2>
    <p class="muted" style="max-width:44rem">Lots ${m.testLots.join(", ")} were never used for training or threshold tuning. ${comb.n_defective} of the parts carry injected latent defects.</p>
    <div class="grid g4" style="margin-top:24px">
      ${kpi(pct(comb.recall), "Defect recall", `vs ${pct(rules.recall)} for static datasheet + delta rules alone`, true)}
      ${kpi(`${comb.escapes}<span class="muted" style="font-size:.5em"> / ${comb.n_defective}</span>`, "Escapes", `static rules let ${rules.escapes} through; overkill ${pct(comb.overkill_rate)}`)}
      ${kpi(`${def.nmae.toFixed(1)}%`, "168 h forecast error", `normalised MAE from 0 h + 24 h only, vs ${naive.nmae.toFixed(1)}% naive extrapolation`)}
      ${kpi("100%", "Explained", "every REJECT and REVIEW carries reason codes, SHAP drivers and a plain-language note")}
    </div>
  </section>

  <section class="section wrap">
    <span class="eyebrow">How it works</span>
    <h2>Rules first. AI adds rejects. Everything is explained.</h2>
    <div class="grid g4" style="margin-top:28px">
      <div class="card"><div class="icon">${ICONS.a}</div><div class="step-no">MODULE A</div><h3>Lot-relative outliers</h3>
        <p class="muted small">DPAT robust limits (median ± k·robust σ, log scale for currents), per-lot MinCovDet Mahalanobis distance and an Isolation Forest over lot-normalised levels and drifts.</p></div>
      <div class="card"><div class="icon">${ICONS.b}</div><div class="step-no">MODULE B</div><h3>24 h drift forecast</h3>
        <p class="muted small">Forecasts the 168 h value from 0 h + 24 h (physics power law, hybrid, XGBoost, Ridge) with conformal bounds, and compares the upper-bound slope to a safety slope: min(spec delta, lot slope, mission-life Arrhenius).</p></div>
      <div class="card"><div class="icon">${ICONS.d}</div><div class="step-no">DECISION ENGINE</div><h3>Cost-sensitive verdict</h3>
        <p class="muted small">Datasheet and MIL-STD-883 style delta limits are never waived. Thresholds minimise ${m.config.costFN}·escapes + ${m.config.costFP}·false rejects on validation lots, giving ACCEPT / REVIEW / REJECT.</p></div>
      <div class="card"><div class="icon">${ICONS.e}</div><div class="step-no">EXPLANATIONS</div><h3>QA inspector card</h3>
        <p class="muted small">Reason codes, SHAP contributions for both modules, and a sentence-level justification that names the binding safety limit, ready for a screening report.</p></div>
    </div>
    <figure style="margin-top:32px">
      <img class="arch" src="img/fig/13_system_architecture.png" alt="System architecture: data flows through lot-robust features into Module A and Module B, on top of rule screens, into a cost-sensitive decision engine with explanations." loading="lazy">
      <figcaption>System architecture. Rule screens sit underneath both AI modules and can never be overridden.</figcaption>
    </figure>
  </section>

  <section class="section wrap">
    <div class="grid g2">
      <div>
        <span class="eyebrow">Project</span>
        <h2>BurnTestr</h2>
        <p class="muted"><strong>Team CTRL + Win</strong> (Team ID 124241) · Smart India Hackathon · Problem Statement 26170 · ISRO / Department of Space<br>“AI-Driven Anomaly Detection in Component Burn-In &amp; Screening” · Smart Automation · Software</p>
        <p class="small muted">Source code available to evaluators on request. This site only contains exported results on synthetic data, selected figures and browser visualisation.</p>
      </div>
      <div class="callout">
        <strong>What you can do here</strong>
        <ul style="margin:8px 0 0;padding-left:1.1em">
          <li><a href="#/explorer">Explorer</a>: every part in the held-out lots, with its trajectory, forecast, SHAP bars and QA note.</li>
          <li><a href="#/results">Results</a>: confusion matrices, trade-off curves, forecast error and honest limitations.</li>
          <li><a href="#/try">Try it</a>: run a simplified Module A on your own CSV, entirely in the browser.</li>
        </ul>
      </div>
    </div>
  </section>`;

  const chartEl = app.querySelector("#hero-chart");
  const slider = app.querySelector("#med");
  let chart = mount(chartEl, heroChart(10));
  const update = () => {
    const med = Number(slider.value);
    app.querySelector("#med-out").textContent = `${med} µA`;
    chart.disconnect();
    chart = mount(chartEl, heroChart(med));
    const z = Math.log(SUSPECT / med) / SIGMA_LOG;
    const out = z > K;
    app.querySelector("#hook-status").innerHTML =
      `<span class="chip ${SUSPECT <= SPEC ? "" : "bad"}">Datasheet: ${SUSPECT <= SPEC ? "PASS" : "FAIL"}</span>` +
      `<span class="chip ${out ? "bad" : ""}">DPAT: ${out ? "REJECT" : "PASS"} (${z.toFixed(1)} σ from lot)</span>` +
      `<span class="muted">${out ? "Latent defect caught" : "Normal for this lot"}</span>`;
  };
  slider.addEventListener("input", update);
  update();
  return () => chart.disconnect();
}
