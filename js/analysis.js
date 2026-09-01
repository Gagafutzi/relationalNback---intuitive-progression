"use strict";

/* ============================================================
   11b. ANALYSIS

   Reading the block history back. Everything here is derived — nothing in this file
   is stored, so it can be rewritten freely without migrating anyone's record.

   The trap this module exists to avoid: `score` is chance-corrected WITHIN a
   configuration, and the configuration changes constantly because that is what the
   ladder does. 70% at N1 on one stream and 70% at N3 on four are not the same
   number, so a score-over-time chart is a flat line that means nothing. Three
   quantities survive the configuration changing, and those are what get plotted.
   ============================================================ */

/* ---- Inverse normal CDF ----
   Acklam's rational approximation: accurate to ~1.15e-9 across the whole range,
   fifteen lines, no iteration. Needed for d', which is defined in z units. */
const PROBIT_A = [-3.969683028665376e+01,  2.209460984245205e+02, -2.759285104469687e+02,
                   1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
const PROBIT_B = [-5.447609879822406e+01,  1.615858368580409e+02, -1.556989798598866e+02,
                   6.680131188771972e+01, -1.328068155288572e+01];
const PROBIT_C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
                  -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
const PROBIT_D = [ 7.784695709041462e-03,  3.224671290700398e-01,  2.445134137142996e+00,
                   3.754408661907416e+00];

function probit(p) {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const PL = 0.02425;
  let q, r;
  if (p < PL || p > 1 - PL) {
    const tail = p < PL ? p : 1 - p;
    q = Math.sqrt(-2 * Math.log(tail));
    const v = (((((PROBIT_C[0] * q + PROBIT_C[1]) * q + PROBIT_C[2]) * q + PROBIT_C[3]) * q
                 + PROBIT_C[4]) * q + PROBIT_C[5]) /
              ((((PROBIT_D[0] * q + PROBIT_D[1]) * q + PROBIT_D[2]) * q + PROBIT_D[3]) * q + 1);
    return p < PL ? v : -v;
  }
  q = p - 0.5; r = q * q;
  return (((((PROBIT_A[0] * r + PROBIT_A[1]) * r + PROBIT_A[2]) * r + PROBIT_A[3]) * r
            + PROBIT_A[4]) * r + PROBIT_A[5]) * q /
         (((((PROBIT_B[0] * r + PROBIT_B[1]) * r + PROBIT_B[2]) * r + PROBIT_B[3]) * r
            + PROBIT_B[4]) * r + 1);
}

/* ---- Signal detection ----
   Hautus's log-linear correction — half a count added to every cell before rates are
   taken. Without it one flawless block gives a hit rate of exactly 1, z(1) is
   infinite, and a single perfect block blows the whole series up.

   A caveat worth being straight about: textbook d' is for yes/no detection, and only
   the identity streams are that. On a relational stream you pick one of six, and the
   hit/miss/fa/cr counts are tallied per OPTION rather than per trial. What comes out
   is still a monotone sensitivity that separates discrimination from bias, and it is
   still comparable for one stream across time — which is the whole job here — but it
   is not the same number a detection experiment would report, so it is labelled
   "sensitivity" in the UI rather than dressed up as canonical d'. */
const sdtRates = t => [
  (t.hit + 0.5) / (t.hit + t.miss + 1),
  (t.fa  + 0.5) / (t.fa  + t.cr   + 1),
];
const dprime = t => { const [h, f] = sdtRates(t); return probit(h) - probit(f); };
/* Positive = conservative (holding back), negative = trigger-happy. The two need
   opposite corrections, and a raw accuracy figure tells you neither. */
const criterion = t => { const [h, f] = sdtRates(t); return -0.5 * (probit(h) + probit(f)); };
const hasSdt = t => t && (t.hit + t.miss) > 0 && (t.fa + t.cr) > 0;

/* ---- Series ---- */

/* Trailing mean. Per-block numbers are far too noisy to read a trend off directly,
   so the raw points are drawn faintly and this is drawn over them. Trailing, not
   centred: a centred window would let the last few points move as new blocks arrive,
   which reads as the past rewriting itself. */
function rollingMean(ys, win) {
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - win + 1); j <= i; j++)
      if (ys[j] != null && isFinite(ys[j])) { s += ys[j]; n++; }
    out.push(n ? s / n : null);
  }
  return out;
}

/* Blocks worth analysing: scored, and not abandoned or interrupted. An abandoned
   block's score is over however many trials you happened to answer before quitting,
   and an interrupted one was paced by a throttled timer. Including either would
   quietly bias the whole picture downward. */
const analysable = b => b && b.completed !== false && !b.interrupted && b.score != null;

/* Every stream that appears anywhere in the history, in the app's own order so the
   legend does not reshuffle between renders. */
function streamsSeen(blocks) {
  const seen = new Set();
  blocks.forEach(b => Object.keys(b.streams || {}).forEach(k => seen.add(k)));
  return [...STREAM_KEYS, 'position2'].filter(k => seen.has(k));
}

/* ---- Summary numbers for the header ---- */
function progressSummary(blocks) {
  const ok = blocks.filter(analysable);
  const mins = Object.values(progress.dailyMinutes || {}).reduce((s, m) => s + m, 0) +
               Object.values(progress.rollup || {}).reduce((s, r) => s + (r.minutes || 0), 0);
  const rolled = Object.values(progress.rollup || {}).reduce((s, r) => s + r.blocks, 0);

  /* Highest load carried at a real standard, rather than the highest load ever set.
     bestLoad already answers "what did you attempt"; this answers "what held". */
  const CRIT = 0.80;
  const held = ok.filter(b => b.score >= CRIT).map(b => b.load || 0);
  return {
    blocks: ok.length, rolled,
    days: Object.keys(progress.dailyMinutes || {}).length,
    hours: mins / 60,
    bestLoad: progress.bestLoad || 0,
    loadHeld: held.length ? Math.max(...held) : 0,
    crit: CRIT,
  };
}

/* ---- SVG charts ----
   Hand-rolled rather than pulled in, because the whole app is dependency-free and a
   line with a band is not worth a library. Everything is in user units and mapped
   once, so a series can be added without touching the drawing code. */
const SVG_NS = 'http://www.w3.org/2000/svg';

function niceTicks(lo, hi, count) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/* series: [{ name, color, ys:[…|null], dots:[…|null], dashed }]
   band:   { color, lo:[…], hi:[…] }                                 */
function lineChart(opts) {
  const W = opts.width || 760, H = opts.height || 190;
  const P = { l: 46, r: 10, t: 10, b: 22 };
  const n = opts.n;
  const all = [];
  opts.series.forEach(s => { (s.ys || []).forEach(v => all.push(v)); (s.dots || []).forEach(v => all.push(v)); });
  if (opts.band) { opts.band.lo.forEach(v => all.push(v)); opts.band.hi.forEach(v => all.push(v)); }
  (opts.rules || []).forEach(r => all.push(r.y));
  const vals = all.filter(v => v != null && isFinite(v));
  if (!vals.length || n < 2) return `<div class="chart-empty">${opts.empty || 'Not enough data yet.'}</div>`;

  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (opts.zeroFloor && lo > 0) lo = 0;
  if (hi === lo) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;

  const X = i => P.l + (W - P.l - P.r) * (n === 1 ? 0 : i / (n - 1));
  const Y = v => P.t + (H - P.t - P.b) * (1 - (v - lo) / (hi - lo));
  const path = ys => {
    let d = '', pen = false;
    ys.forEach((v, i) => {
      if (v == null || !isFinite(v)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1) + ' ';
      pen = true;
    });
    return d.trim();
  };

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  niceTicks(lo, hi, 4).forEach(t => {
    const y = Y(t);
    svg += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>` +
           `<text class="ax" x="${P.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${
             (opts.yFmt || (v => v))(t)}</text>`;
  });
  if (opts.band) {
    const up = opts.band.hi.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean);
    const dn = opts.band.lo.map((v, i) => v == null ? null : `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).reverse();
    if (up.length > 1)
      svg += `<polygon class="band" points="${up.concat(dn).join(' ')}" fill="${opts.band.color}"/>`;
  }
  (opts.rules || []).forEach(r => {
    svg += `<line class="rule" x1="${P.l}" x2="${W - P.r}" y1="${Y(r.y).toFixed(1)}" y2="${Y(r.y).toFixed(1)}" stroke="${r.color}"/>` +
           `<text class="ax rule-lab" x="${W - P.r}" y="${(Y(r.y) - 4).toFixed(1)}" text-anchor="end" fill="${r.color}">${r.label}</text>`;
  });
  opts.series.forEach(s => {
    (s.dots || []).forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      svg += `<circle class="dot" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="1.7" fill="${s.color}"/>`;
    });
    const d = path(s.ys || []);
    if (d) svg += `<path class="ln${s.dashed ? ' dash' : ''}" d="${d}" stroke="${s.color}"/>`;
  });
  svg += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>`;
  if (opts.xLo) svg += `<text class="ax" x="${P.l}" y="${H - 6}">${opts.xLo}</text>`;
  if (opts.xHi) svg += `<text class="ax" x="${W - P.r}" y="${H - 6}" text-anchor="end">${opts.xHi}</text>`;
  return svg + '</svg>';
}

function barChart(values, labels, color, opts) {
  const W = opts.width || 760, H = opts.height || 120;
  const P = { l: 46, r: 10, t: 10, b: 22 };
  const hi = Math.max(1, ...values);
  const bw = (W - P.l - P.r) / Math.max(1, values.length);
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  niceTicks(0, hi, 3).forEach(t => {
    const y = P.t + (H - P.t - P.b) * (1 - t / hi);
    svg += `<line class="grid" x1="${P.l}" x2="${W - P.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>` +
           `<text class="ax" x="${P.l - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${t}</text>`;
  });
  values.forEach((v, i) => {
    const h = (H - P.t - P.b) * (v / hi);
    svg += `<rect x="${(P.l + i * bw + bw * 0.15).toFixed(1)}" y="${(H - P.b - h).toFixed(1)}" ` +
           `width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" ` +
           `rx="1.5" fill="${color}" opacity="${v ? 0.9 : 0.15}"/>`;
  });
  svg += `<line class="axis" x1="${P.l}" x2="${W - P.r}" y1="${H - P.b}" y2="${H - P.b}"/>`;
  if (labels[0]) svg += `<text class="ax" x="${P.l}" y="${H - 6}">${labels[0]}</text>`;
  if (labels[labels.length - 1])
    svg += `<text class="ax" x="${W - P.r}" y="${H - 6}" text-anchor="end">${labels[labels.length - 1]}</text>`;
  return svg + '</svg>';
}

/* ============================================================
   The progress view. Three quantities, because those are the three that survive the
   configuration changing underneath them.
   ============================================================ */

const fmtS = ms => (ms / 1000).toFixed(2) + 's';

function progressHTML() {
  const blocks = (progress.blocks || []).filter(analysable);
  const s = progressSummary(progress.blocks || []);

  if (blocks.length < 2) {
    return `<h2>Progress</h2>
      <p>Nothing to plot yet — ${blocks.length} completed block${blocks.length === 1 ? '' : 's'}
      on record. Come back after a handful.</p>`;
  }

  const dates = blocks.map(b => new Date(b.ts));
  const d0 = dates[0].toISOString().slice(0, 10);
  const d1 = dates[dates.length - 1].toISOString().slice(0, 10);
  const WIN = Math.max(3, Math.min(9, Math.round(blocks.length / 8)));

  /* ---- 1. Speed ----
     Progression blocks only, split by tier: the two tracks have their own ladders and
     their own targets, so pooling them would draw a line through two different tasks.
     The interval each block was actually played AT is the series, because the
     staircase places every block at its current threshold estimate — so the interval
     history IS the threshold history, and unlike the posterior it was recorded from
     the very first block. Where the posterior mean was also stored, its 90% band is
     drawn behind. */
  const prog3 = blocks.filter(b => b.mode === 'progression');
  let speed = '';
  if (prog3.length >= 2) {
    const tiers = [...new Set(prog3.map(b => b.rcTier || 3))].sort();
    const COLOR = { 3: '#4dabf7', 4: '#cc5de8' };
    const series = [], n = prog3.length;
    tiers.forEach(t => {
      const ys = prog3.map(b => (b.rcTier || 3) === t ? (b.cfg && b.cfg.interval) : null);
      series.push({ name: `RC ${t}`, color: COLOR[t] || '#8ab4ff', dots: ys,
                    ys: rollingMean(ys, WIN) });
    });
    const haveThr = prog3.some(b => b.thrLo != null);
    const band = haveThr ? { color: 'rgba(138,180,255,.16)',
                             lo: prog3.map(b => b.thrLo ?? null),
                             hi: prog3.map(b => b.thrHi ?? null) } : null;
    const target = prog3[prog3.length - 1].cfg && tune.targetInterval;
    speed = `
      <h3>Speed <span class="ch-sub">seconds per trial · lower is better</span></h3>
      ${lineChart({ n, series, band, width: 760, height: 200,
                    yFmt: v => (v / 1000).toFixed(1) + 's',
                    rules: target ? [{ y: target, color: '#51cf66', label: 'target' }] : [],
                    xLo: d0, xHi: d1 })}
      <div class="ch-legend">${series.map(x =>
        `<span><i style="background:${x.color}"></i>${x.name}</span>`).join('')}${
        haveThr ? '<span><i class="band-key"></i>90% credible band</span>' : ''}</div>
      <p class="ch-note">Faint dots are single blocks; the line is a ${WIN}-block trailing
      mean. The staircase parks each block at its current estimate of your threshold, so
      this is that estimate over time. Tiers are drawn apart because they are separate
      ladders against separate targets${haveThr ? '' :
        ' — the credible band appears once blocks recorded after this build accumulate'}.</p>`;
  }

  /* ---- 2 & 3. Sensitivity and bias ---- */
  const keys = streamsSeen(blocks);
  const n = blocks.length;
  const mk = f => keys.map(k => {
    const ys = blocks.map(b => {
      const t = b.streams && b.streams[k];
      return hasSdt(t) ? f(t) : null;
    });
    return { name: labelFor(k), color: colorFor(k), dots: ys, ys: rollingMean(ys, WIN) };
  }).filter(x => x.dots.some(v => v != null));

  const dSeries = mk(dprime), cSeries = mk(criterion);
  const legend = ss => `<div class="ch-legend">${ss.map(x =>
    `<span><i style="background:${x.color}"></i>${x.name}</span>`).join('')}</div>`;

  const sens = !dSeries.length ? '' : `
    <h3>Sensitivity <span class="ch-sub">d′ per stream · higher is better</span></h3>
    ${lineChart({ n, series: dSeries.map(x => ({ ...x, dots: null })), width: 760, height: 200,
                  yFmt: v => v.toFixed(1), xLo: d0, xHi: d1 })}
    ${legend(dSeries)}
    <p class="ch-note">How cleanly you tell a target from a non-target, with your
    willingness to press divided out. This is the chart that catches improvement that
    is really just caution: press less and accuracy rises while sensitivity does not
    move. Around 0 is chance, 1 is workable, above 2 is strong. Computed per response
    option rather than per trial, so it is comparable for one stream over time rather
    than against a textbook figure.</p>`;

  const bias = !cSeries.length ? '' : `
    <h3>Bias <span class="ch-sub">criterion · 0 is neutral</span></h3>
    ${lineChart({ n, series: cSeries.map(x => ({ ...x, dots: null })), width: 760, height: 170,
                  yFmt: v => v.toFixed(1), rules: [{ y: 0, color: 'rgba(255,255,255,.35)', label: 'neutral' }],
                  xLo: d0, xHi: d1 })}
    ${legend(cSeries)}
    <p class="ch-note">Above the line you are holding back and missing targets; below
    it you are pressing at things that are not there. The two need opposite fixes, and
    a single accuracy figure tells you neither.</p>`;

  /* ---- 4. Volume ---- */
  const day = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    day.push([d, Math.round(progress.dailyMinutes[d] || 0)]);
  }
  const vol = `
    <h3>Volume <span class="ch-sub">minutes in blocks · last 30 days</span></h3>
    ${barChart(day.map(d => d[1]), day.map(d => d[0].slice(5)), 'var(--accent, #4d7fd6)',
               { width: 760, height: 120 })}`;

  const thr = tune.adapt === 'bayes' && stairLog
    ? `${fmtS(stairThresholdMs())} <span class="ch-sub">±${
        stairCI(0.9).map(v => (v / 1000).toFixed(2)).join('–')}s</span>` : '—';

  return `
    <h2>Progress</h2>
    <div class="prog-summary">
      <div><span class="k">Blocks</span><b>${s.blocks}</b>${
        s.rolled ? `<span class="ch-sub">+${s.rolled} rolled up</span>` : ''}</div>
      <div><span class="k">Time</span><b>${s.hours.toFixed(1)}h</b><span class="ch-sub">over ${s.days} days</span></div>
      <div><span class="k">Load held</span><b>${s.loadHeld || '—'}</b><span class="ch-sub">${
        s.loadHeld ? `at ≥${Math.round(s.crit*100)}%` : `no block at ≥${Math.round(s.crit*100)}% yet`
        }${s.bestLoad ? ` · best set ${s.bestLoad}` : ''}</span></div>
      <div><span class="k">Threshold</span><b>${thr}</b><span class="ch-sub">RC ${rcTier}, now</span></div>
    </div>
    ${speed}${sens}${bias}${vol}
    <p class="ch-note" style="margin-top:16px">
      Block <b>score</b> is deliberately absent. It is chance-corrected inside one
      configuration, and the ladder changes the configuration constantly — 70% at N1 on
      one stream and 70% at N3 on four are not the same number, so a score line would
      run flat whatever you did. Everything above survives the settings moving.
      Abandoned and tab-interrupted blocks are excluded throughout.</p>`;
}

function showProgress() {
  /* Escape closes any modal without going through its button, so the wide class is
     cleared on the way IN as well — otherwise the next report inherits a 900px box. */
  modalBox.classList.add('wide');
  modalBox.innerHTML = progressHTML() +
    `<button class="cta" id="progClose">Close</button>`;
  modalEl.classList.add('open');
  $('progClose').onclick = () => {
    modalEl.classList.remove('open');
    modalBox.classList.remove('wide');
  };
}
