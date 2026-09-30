import { downloadText, esc, fmt, loadJSON, pct } from "../util.js";
import { parseCSV, REQUIRED, screen, toCSV } from "../dpat.js";

const MAX_ROWS = 200;
const SAMPLE_LOTS = ["L08", "L10", "L11"];

// Build the sample CSV from the exported synthetic lots (no separate data file needed).
async function sampleCSV() {
  const d = await loadJSON("data/lots.json");
  const lots = Object.fromEntries(d.lots.map((l) => [l.id, l]));
  const header = ["Lot_ID", "Component_ID", "Param_Name", "Value_0h", "Value_24h", "Value_96h", "Value_168h", "Unit", "Spec_Max", "Is_Defective", "Defect_Type"];
  const rows = [];
  for (const p of d.parts) {
    if (!SAMPLE_LOTS.includes(p.lot)) continue;
    for (const [param, b] of Object.entries(p.p)) {
      const L = lots[p.lot].params[param];
      rows.push([p.lot, p.id, param, ...b.v, L.unit, L.specMax, p.y, p.type]);
    }
  }
  return toCSV(header, rows);
}

const FLAG_CLASS = { SPEC: "bad", DELTA: "bad", DPAT: "warn", DRIFT: "info" };

export async function render(app) {
  app.innerHTML = `
  <section class="wrap section-tight">
    <span class="eyebrow">Try it · runs in your browser</span>
    <h1 style="font-size:clamp(1.8rem,3.5vw,2.4rem)">Try BurnTestr on your CSV</h1>
    <p class="lead">Upload a CSV or load the sample. Nothing leaves your browser.</p>
    <div class="notice" style="margin:18px 0 24px;max-width:52rem">
      <b>This is a simplified, client-side Module A.</b> It computes per-lot robust DPAT limits (median ± k·IQR/1.35, log scale for currents), robust z-scores, change from 0 h, a lot drift-slope check (lot median slope + k·robust σ) and datasheet / delta checks. The full ML system (per-lot Mahalanobis, Isolation Forest, the Module B drift forecaster, cost-tuned thresholds and SHAP explanations) runs in Python and is not included here.
    </div>
    <div class="grid g2">
      <div>
        <div class="dropzone" id="drop">
          <p style="margin:0 0 12px"><b>Drop a CSV here</b> or</p>
          <div class="row" style="justify-content:center">
            <label class="btn btn-primary" for="file">Choose file</label><input id="file" type="file" accept=".csv,text/csv">
            <button class="btn" id="sample" type="button">Load sample</button>
            <button class="btn" id="dl-sample" type="button">Download sample CSV</button>
          </div>
          <p class="small muted" id="file-status" style="margin:12px 0 0" aria-live="polite">No file loaded.</p>
        </div>
      </div>
      <div class="card">
        <h3 style="font-size:.95rem">Expected schema (one row per component × parameter)</h3>
        <p class="small mono" style="word-break:break-word">${REQUIRED.join(", ")}</p>
        <p class="small muted" style="margin:0">Optional: <code>Spec_Max</code>, <code>Spec_Min</code>, <code>Unit</code>, <code>Delta_Pct</code>, <code>Delta_Floor</code>, and <code>Is_Defective</code> (0/1) to score recall and overkill. Built-in defaults for Iddq (max 25 µA), Leakage (50 µA) and Prop_Delay (20 ns) apply when <code>Spec_Max</code> is missing.</p>
      </div>
    </div>
    <div class="toolbar" style="margin-top:26px">
      <label class="field slider-field">DPAT k (robust σ): <output id="k-out">6.0</output><input id="k" type="range" min="2" max="9" step="0.5" value="6"></label>
      <label class="field slider-field">Drift-slope k: <output id="sk-out">6.0</output><input id="sk" type="range" min="2" max="12" step="0.5" value="6"></label>
      <label class="field" style="flex-direction:row;align-items:center;gap:8px;color:var(--text)"><input id="log" type="checkbox" checked> Log scale for currents</label>
    </div>
  </section>
  <section class="wrap section-tight" id="out" style="padding-top:0"></section>`;

  const $ = (s) => app.querySelector(s);
  let data = null, fileName = "data.csv";

  const run = () => {
    const k = Number($("#k").value), slopeK = Number($("#sk").value);
    $("#k-out").textContent = k.toFixed(1);
    $("#sk-out").textContent = slopeK.toFixed(1);
    if (!data) return;
    const res = screen(data.records, { k, slopeK, useLog: $("#log").checked });
    const ev = res.eval;
    const flagged = [...res.flagged].sort((a, b) => b.flags.length - a.flags.length || b.maxZ - a.maxZ);
    $("#out").innerHTML = `
      <div class="grid g4">
        <div class="card kpi"><div class="kpi-value">${res.components.length}</div><div class="kpi-label">Components</div><div class="kpi-sub">${res.lots} lot${res.lots === 1 ? "" : "s"}, ${data.records.length} rows</div></div>
        <div class="card kpi"><div class="kpi-value accent">${flagged.length}</div><div class="kpi-label">Flagged</div><div class="kpi-sub">${pct(flagged.length / Math.max(1, res.components.length))} of components</div></div>
        <div class="card kpi"><div class="kpi-value">${flagged.filter((c) => c.flags.includes("SPEC") || c.flags.includes("DELTA")).length}</div><div class="kpi-label">Rule failures</div><div class="kpi-sub">datasheet or delta limit</div></div>
        <div class="card kpi">${ev ? `<div class="kpi-value">${pct(ev.recall)}</div><div class="kpi-label">Recall vs labels</div><div class="kpi-sub">overkill ${pct(ev.overkill, 2)} · ${ev.fn} missed</div>` : `<div class="kpi-value">${flagged.filter((c) => !c.flags.includes("SPEC") && !c.flags.includes("DELTA")).length}</div><div class="kpi-label">Latent only</div><div class="kpi-sub">flagged while inside datasheet and delta limits</div>`}</div>
      </div>
      ${res.warnings.length ? `<div class="notice" style="margin-top:16px">${res.warnings.map(esc).join("<br>")}</div>` : ""}
      ${data.badLines.length ? `<div class="notice" style="margin-top:12px">Skipped ${data.badLines.length} row(s) with non-numeric values (line${data.badLines.length > 1 ? "s" : ""} ${data.badLines.slice(0, 8).join(", ")}${data.badLines.length > 8 ? "…" : ""}).</div>` : ""}
      <div class="row" style="margin:28px 0 12px"><h2 style="margin:0">Flagged parts</h2><span class="spacer"></span>
        <button class="btn btn-primary" id="dl" ${flagged.length ? "" : "disabled"}>Download flagged CSV</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Lot</th><th>Component</th><th>Flags</th><th class="num">Max |z|</th>${ev ? "<th>Label</th>" : ""}<th>Why</th></tr></thead>
        <tbody>${flagged.length ? flagged.slice(0, MAX_ROWS).map((c) => `<tr>
          <td class="mono">${esc(c.lot)}</td><td class="mono">${esc(c.id)}</td>
          <td>${c.flags.map((fl) => `<span class="chip ${FLAG_CLASS[fl]}">${fl}</span>`).join("")}</td>
          <td class="num">${c.maxZ ? c.maxZ.toFixed(1) : "—"}</td>
          ${ev ? `<td>${c.truth ? '<span style="color:var(--reject)">defective</span>' : '<span class="muted">good</span>'}</td>` : ""}
          <td><ul class="reason-list small">${c.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></td></tr>`).join("")
          : `<tr><td colspan="6" class="muted">No parts flagged at these settings.</td></tr>`}</tbody>
      </table></div>
      ${flagged.length > MAX_ROWS ? `<p class="small muted" style="margin-top:8px">Showing the first ${MAX_ROWS} of ${flagged.length}; the download contains all of them.</p>` : ""}
      <h2 style="margin-top:40px">Lot statistics</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Lot</th><th>Parameter</th><th class="num">n</th><th class="num">Median 168 h</th><th class="num">DPAT window 168 h</th><th class="num">Drift limit (/h)</th><th class="num">Datasheet max</th><th class="num">Flagged</th></tr></thead>
        <tbody>${res.stats.map((s) => `<tr><td class="mono">${esc(s.lot)}</td><td>${esc(s.param)}${s.log ? ' <span class="faint small">log</span>' : ""}</td><td class="num">${s.n}</td>
          <td class="num">${s.small ? "—" : fmt(s.median168)}</td><td class="num">${s.small ? "too small" : `${fmt(s.win168[0])}–${fmt(s.win168[1])}`}</td>
          <td class="num">${s.small ? "—" : fmt(s.slopeHi)}</td><td class="num">${Number.isFinite(s.specMax) ? fmt(s.specMax) : "—"}</td><td class="num">${s.flagged}</td></tr>`).join("")}</tbody>
      </table></div>`;
    $("#dl")?.addEventListener("click", () => {
      const extra = ["Flags", "Reasons"];
      const header = [...data.header, ...extra];
      const rows = flagged.flatMap((c) => c.rows.map((r) => [...data.header.map((h) => r[h]), c.flags.join("|"), c.reasons.join(" ")]));
      downloadText(fileName.replace(/\.csv$/i, "") + "_flagged.csv", toCSV(header, rows));
    });
  };

  const load = (text, name) => {
    try {
      data = parseCSV(text);
      fileName = name;
      if (!data.records.length) throw new Error("No valid data rows found.");
      $("#file-status").textContent = `Loaded ${name}: ${data.records.length} rows.`;
      run();
    } catch (err) {
      data = null;
      $("#file-status").innerHTML = `<span class="error">${esc(err.message)}</span>`;
      $("#out").innerHTML = "";
    }
  };
  const readFile = (file) => {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { $("#file-status").innerHTML = '<span class="error">File is larger than 30 MB.</span>'; return; }
    file.text().then((t) => load(t, file.name));
  };

  $("#file").addEventListener("change", (e) => readFile(e.target.files[0]));
  $("#sample").addEventListener("click", async () => load(await sampleCSV(), "sample_L08_L10_L11.csv"));
  $("#dl-sample").addEventListener("click", async () => downloadText("burnin_sample.csv", await sampleCSV()));
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => readFile(e.dataTransfer.files[0]));
  for (const id of ["#k", "#sk", "#log"]) $(id).addEventListener("input", run);
}
