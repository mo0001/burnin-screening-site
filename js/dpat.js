// Simplified client-side Module A: per-lot robust DPAT, delta, drift-slope and datasheet checks.
// The full system (Mahalanobis, Isolation Forest, drift forecasting, SHAP) runs in Python.

export const TIMES = ["0h", "24h", "96h", "168h"];
export const VALUE_COLS = TIMES.map((t) => `Value_${t}`);
export const REQUIRED = ["Lot_ID", "Component_ID", "Param_Name", ...VALUE_COLS];

// Defaults mirror the project's datasheet table; per-row Spec_Max / Spec_Min / Delta_Pct / Delta_Floor override them.
export const DATASHEET = {
  Iddq: { unit: "µA", max: 25, deltaPct: 0.5, deltaFloor: 1.0, log: true, twoSided: false },
  Leakage: { unit: "µA", max: 50, deltaPct: 1.0, deltaFloor: 0.5, log: true, twoSided: false },
  Prop_Delay: { unit: "ns", max: 20, deltaPct: 0.08, deltaFloor: 0.2, log: false, twoSided: true },
};
const MIN_LOT = 8;

export function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  if (!rows.length) throw new Error("The file is empty.");
  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Missing required column(s): ${missing.join(", ")}`);
  const records = [];
  const bad = [];
  rows.slice(1).forEach((r, i) => {
    const o = {};
    header.forEach((h, j) => { o[h] = (r[j] ?? "").trim(); });
    const vals = VALUE_COLS.map((c) => Number(o[c]));
    if (vals.some((v) => !Number.isFinite(v))) { bad.push(i + 2); return; }
    o._v = vals;
    records.push(o);
  });
  return { header, records, badLines: bad };
}

export const toCSV = (header, rows) =>
  [header, ...rows].map((r) => r.map((v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
export function robust(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const med = quantile(s, 0.5);
  let sigma = (quantile(s, 0.75) - quantile(s, 0.25)) / 1.35;
  if (!(sigma > 0)) {
    const mad = quantile(xs.map((x) => Math.abs(x - med)).sort((a, b) => a - b), 0.5) * 1.4826;
    sigma = mad;
  }
  return { med, sigma: Math.max(sigma || 0, 1e-9 + 1e-6 * Math.abs(med)) };
}

const num = (v) => (v === undefined || v === "" ? NaN : Number(v));
const f = (v) => {
  if (!Number.isFinite(v)) return "∞";
  const a = Math.abs(v);
  return a !== 0 && (a < 1e-3 || a >= 1e5) ? v.toExponential(2) : String(Number(v.toPrecision(3)));
};
const sgn = (v) => (v > 0 ? "+" : "") + f(v);

function specFor(rec) {
  const d = DATASHEET[rec.Param_Name] || {};
  const spec = {
    unit: rec.Unit || d.unit || "",
    max: Number.isFinite(num(rec.Spec_Max)) ? num(rec.Spec_Max) : d.max ?? Infinity,
    min: Number.isFinite(num(rec.Spec_Min)) ? num(rec.Spec_Min) : -Infinity,
    deltaPct: Number.isFinite(num(rec.Delta_Pct)) ? num(rec.Delta_Pct) : d.deltaPct,
    deltaFloor: Number.isFinite(num(rec.Delta_Floor)) ? num(rec.Delta_Floor) : d.deltaFloor,
    log: d.log ?? /idd|leak|current/i.test(rec.Param_Name),
    twoSided: d.twoSided ?? !/idd|leak|current/i.test(rec.Param_Name),
  };
  return spec;
}

/**
 * Screen all records. Returns per-component results, per-(lot, param) stats and warnings.
 * opts: { k, slopeK, useLog }
 */
export function screen(records, { k = 6, slopeK = 6, useLog = true } = {}) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.Lot_ID}\u0000${r.Param_Name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const comps = new Map();
  const stats = [];
  const warnings = [];
  const comp = (r) => {
    const key = `${r.Lot_ID}\u0000${r.Component_ID}`;
    if (!comps.has(key)) comps.set(key, { lot: r.Lot_ID, id: r.Component_ID, flags: new Set(), reasons: [], rows: [], maxZ: 0, truth: null });
    return comps.get(key);
  };

  for (const rs of groups.values()) {
    const { Lot_ID: lot, Param_Name: param } = rs[0];
    const spec = specFor(rs[0]);
    const logOK = useLog && spec.log && rs.every((r) => r._v.every((v) => v > 0));
    const tr = (v) => (logOK ? Math.log(v) : v);
    const small = rs.length < MIN_LOT;
    if (small) warnings.push(`Lot ${lot} / ${param}: only ${rs.length} parts, so DPAT and drift checks were skipped (need ≥ ${MIN_LOT}).`);
    const st = TIMES.map((_, i) => robust(rs.map((r) => tr(r._v[i]))));
    const slopes = rs.map((r) => (r._v[3] - r._v[0]) / 168);
    const ss = robust(slopes);
    const slopeHi = ss.med + slopeK * ss.sigma, slopeLo = ss.med - slopeK * ss.sigma;
    const back = (x) => (logOK ? Math.exp(x) : x);
    const win168 = [back(st[3].med - k * st[3].sigma), back(st[3].med + k * st[3].sigma)];
    let flaggedHere = 0;

    for (const r of rs) {
      const c = comp(r);
      c.rows.push(r);
      if (r.Is_Defective !== undefined && r.Is_Defective !== "") c.truth = (c.truth || 0) | (Number(r.Is_Defective) ? 1 : 0);
      const u = spec.unit ? ` ${spec.unit}` : "";
      let hit = false;
      // datasheet
      const over = r._v.findIndex((v) => v > spec.max), under = r._v.findIndex((v) => v < spec.min);
      if (over >= 0) { c.flags.add("SPEC"); hit = true; c.reasons.push(`${param} = ${f(r._v[over])}${u} at ${TIMES[over]} exceeds the datasheet max ${f(spec.max)}${u}.`); }
      else if (under >= 0) { c.flags.add("SPEC"); hit = true; c.reasons.push(`${param} = ${f(r._v[under])}${u} at ${TIMES[under]} is below the datasheet min ${f(spec.min)}${u}.`); }
      // delta vs 0h
      if (Number.isFinite(spec.deltaPct) && Number.isFinite(spec.deltaFloor)) {
        const allow = Math.max(spec.deltaPct * Math.abs(r._v[0]), spec.deltaFloor);
        let worst = 0, wi = 0;
        for (let i = 1; i < 4; i++) { const dlt = r._v[i] - r._v[0]; if (Math.abs(dlt) > Math.abs(worst)) { worst = dlt; wi = i; } }
        if (Math.abs(worst) > allow) {
          c.flags.add("DELTA"); hit = true;
          c.reasons.push(`${param} changed ${sgn(worst)}${u} from 0h to ${TIMES[wi]}; the delta limit is ±${f(allow)}${u} (${Math.round(spec.deltaPct * 100)}% of initial or ${f(spec.deltaFloor)}${u}, whichever is greater).`);
        }
      }
      if (!small) {
        // DPAT per timepoint
        let wz = 0, wi = 0;
        r._v.forEach((v, i) => { const z = (tr(v) - st[i].med) / st[i].sigma; if (Math.abs(z) > Math.abs(wz)) { wz = z; wi = i; } });
        c.maxZ = Math.max(c.maxZ, Math.abs(wz));
        if (Math.abs(wz) > k) {
          c.flags.add("DPAT"); hit = true;
          const lo = back(st[wi].med - k * st[wi].sigma), hi = back(st[wi].med + k * st[wi].sigma);
          c.reasons.push(`${param} at ${TIMES[wi]} = ${f(r._v[wi])}${u} is ${Math.abs(wz).toFixed(1)} robust σ ${wz > 0 ? "above" : "below"} the lot median ${f(back(st[wi].med))}${u}${logOK ? " (log scale)" : ""}; the lot's DPAT window is ${f(lo)}–${f(hi)}${u}.${over < 0 && under < 0 ? " It is still inside the datasheet limit." : ""}`);
        }
        // drift slope vs lot
        const s = (r._v[3] - r._v[0]) / 168;
        const up = s > slopeHi, down = spec.twoSided && s < slopeLo;
        if (up || down) {
          c.flags.add("DRIFT"); hit = true;
          c.reasons.push(`${param} drifted ${sgn(s)}${u}/h over 168 h, ${up ? "faster than" : "more negative than"} the lot drift limit ${sgn(up ? slopeHi : slopeLo)}${u}/h (lot median ${sgn(ss.med)} ${up ? "+" : "−"} ${slopeK}·robust σ).`);
        }
      }
      if (hit) flaggedHere++;
    }
    stats.push({
      lot, param, n: rs.length, unit: spec.unit, log: logOK, small,
      median168: back(st[3].med), sigma168: st[3].sigma, win168, slopeMed: ss.med, slopeHi, specMax: spec.max, flagged: flaggedHere,
    });
  }

  const components = [...comps.values()].map((c) => ({ ...c, flags: [...c.flags], flagged: c.flags.size > 0 }));
  const flagged = components.filter((c) => c.flagged);
  const labelled = components.filter((c) => c.truth !== null);
  let eval_ = null;
  if (labelled.length === components.length && labelled.some((c) => c.truth)) {
    const tp = labelled.filter((c) => c.truth && c.flagged).length, fn = labelled.filter((c) => c.truth && !c.flagged).length;
    const fp = labelled.filter((c) => !c.truth && c.flagged).length, tn = labelled.filter((c) => !c.truth && !c.flagged).length;
    eval_ = { tp, fn, fp, tn, recall: tp / (tp + fn), overkill: fp / (fp + tn) };
  }
  stats.sort((a, b) => String(a.lot).localeCompare(String(b.lot)) || String(a.param).localeCompare(String(b.param)));
  return { components, flagged, stats, warnings, eval: eval_, lots: new Set(components.map((c) => c.lot)).size };
}
