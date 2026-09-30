import { esc, loadJSON } from "../util.js";

// Add team members here, e.g. { name: "Full Name", role: "ML pipeline" }. The section is hidden while empty.
const TEAM_MEMBERS = [];

export async function render(app) {
  const m = await loadJSON("data/metrics.json");
  const c = m.config;
  const ds = Object.entries(c.datasheet);

  app.innerHTML = `
  <section class="wrap section-tight">
    <span class="eyebrow">About</span>
    <h1 style="font-size:clamp(1.8rem,3.5vw,2.4rem)">BurnTestr</h1>
    <p class="tagline">Lot-aware burn-in screening that flags components likely to fail later.</p>
    <p class="lead"><strong>Team CTRL + Win</strong> (Team ID 124241) · Smart India Hackathon · Problem Statement 26170 · ISRO / Department of Space<br>“AI-Driven Anomaly Detection in Component Burn-In &amp; Screening” · Smart Automation · Software</p>
    ${TEAM_MEMBERS.length ? `<ul class="team-list" style="margin-top:18px">${TEAM_MEMBERS.map((t) => `<li><b>${esc(t.name)}</b>${t.role ? ` <span class="muted small">· ${esc(t.role)}</span>` : ""}</li>`).join("")}</ul>` : ""}
  </section>

  <section class="wrap section-tight">
    <div class="grid g2">
      <div>
        <h2>The problem</h2>
        <p>Space-grade EEE parts are burned in (here ${c.tBurninC} °C for 168 h) and measured at 0, 24, 96 and 168 h. Parameters such as quiescent supply current (Iddq), leakage and propagation delay are compared with datasheet limits and delta limits.</p>
        <p>Static limits are set for the worst acceptable lot, so a part can be a gross outlier within its own lot, or drift abnormally, while staying inside spec. Those latent defects are the ones that fail in orbit.</p>
      </div>
      <div>
        <h2>The approach</h2>
        <ol style="padding-left:1.2em;margin:0">
          <li><b>Rule screens</b> (never waived): datasheet limits and “X % of initial or Y, whichever is greater” delta limits, plus lot PDA.</li>
          <li><b>Module A</b>: lot-relative outliers. DPAT robust limits (k = ${c.dpatK}), per-lot MinCovDet Mahalanobis distance, Isolation Forest.</li>
          <li><b>Module B</b>: forecast Value_168h from 0 h + 24 h with a physics power law, hybrid, XGBoost or Ridge model and conformal bounds; flag when the upper-bound slope beats the safety slope = min(spec delta, lot robust slope, mission-life Arrhenius slope).</li>
          <li><b>Decision engine</b>: thresholds minimise ${c.costFN}·FN + ${c.costFP}·FP on validation lots; REVIEW band at ${c.reviewFrac}× threshold.</li>
          <li><b>Explanations</b>: reason codes, SHAP for both modules and plain-language QA text naming the binding limit.</li>
        </ol>
      </div>
    </div>
  </section>

  <section class="wrap section-tight">
    <h2>Configuration used</h2>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><dl class="kv">
        <dt>Burn-in</dt><dd>${c.tBurninC} °C, 168 h, reads at 0 / 24 / 96 / 168 h</dd>
        <dt>Mission life</dt><dd>${c.missionYears} years at ${c.tFieldC} °C</dd>
        <dt>Activation energy</dt><dd>E<sub>a</sub> = ${c.eaEv} eV → acceleration factor ≈ ${Math.round(c.arrheniusAF)}</dd>
        <dt>DPAT</dt><dd>k = ${c.dpatK} robust σ; lot slope k = ${c.slopeK}</dd>
        <dt>Costs</dt><dd>C<sub>FN</sub> = ${c.costFN}, C<sub>FP</sub> = ${c.costFP}</dd>
        <dt>Forecast band</dt><dd>${Math.round(c.piQuantile * 100)}% conformalised quantile bound</dd>
      </dl></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Parameter</th><th class="num">Datasheet max</th><th class="num">Delta limit</th><th>Scale</th></tr></thead>
        <tbody>${ds.map(([p, s]) => `<tr><td>${esc(p)}</td><td class="num">${s.max} ${esc(s.unit)}</td><td class="num">${Math.round(s.delta_pct * 100)}% or ${s.delta_floor} ${esc(s.unit)}</td><td>${s.log_scale ? "log" : "linear"}${s.two_sided ? ", two-sided" : ""}</td></tr>`).join("")}</tbody>
      </table></div>
    </div>
    <p class="small muted" style="margin-top:10px">Physics constants and limits are representative defaults, to be replaced with values from the part's procurement specification.</p>
  </section>

  <section class="wrap section-tight">
    <h2>Standards referenced</h2>
    <div class="grid g2" style="margin-top:12px">
      <div class="card"><h3>MIL-STD-883, TM 1015</h3><p class="small muted">Burn-in test method for microcircuits; with TM 5004 it defines screening flows, delta-limit style post-burn-in criteria and PDA.</p></div>
      <div class="card"><h3>AEC-Q001</h3><p class="small muted">Guidelines for Part Average Testing. Dynamic PAT sets per-lot limits from robust statistics, which is the basis of Module A's DPAT layer.</p></div>
      <div class="card"><h3>ESCC (e.g. ESCC 9000 series)</h3><p class="small muted">European Space Components Coordination generic specifications for screening and burn-in of space-grade components, including drift (delta) limits.</p></div>
      <div class="card"><h3>ECSS-Q-ST-60</h3><p class="small muted">ECSS standard for EEE components in space projects: selection, procurement, screening and lot acceptance requirements.</p></div>
    </div>
  </section>

  <section class="wrap section">
    <h2>Data sources &amp; attribution</h2>
    <ul class="limits" style="max-width:52rem">
      <li><b>Synthetic burn-in lots</b> (all part-level data on this site): generated by the project's own simulator with log-normal part-to-part variation, lot shifts, power-law drift, measurement noise, tester glitches and six injected defect types. No real component data is published here.</li>
      <li><b>Iowa State University SMRD2 degradation data</b> (Meeker &amp; Escobar), used to validate Module B forecasting. Licensed <a href="https://creativecommons.org/licenses/by/4.0/" rel="noopener">CC BY 4.0</a>, DOI <a href="https://doi.org/10.25380/iastate.14454765" rel="noopener">10.25380/iastate.14454765</a>. Only aggregate MAE results are shown on this site.</li>
      <li><b>Code</b>: the ML system (Python) is not published on this site. Source code is available to evaluators on request. This public site contains exported results, selected figures and client-side visualisation code only.</li>
    </ul>
    <p class="small muted" style="margin-top:24px">BurnTestr · Team CTRL + Win (Team ID 124241) · Smart India Hackathon · Problem Statement 26170 · ISRO / Department of Space</p>
  </section>`;
}
