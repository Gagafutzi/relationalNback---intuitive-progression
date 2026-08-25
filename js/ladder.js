"use strict";

/* ============================================================
   2. PROGRESSION LADDER

   An odometer. The interval is the fastest-rolling digit; when it reaches the
   target it carries into the next digit up:

       interval  →  rotation speed  →  N  →  number of stimuli

   Order of introduction: position is relational from the very first block. Every
   stream added after it enters as an identity judgement, except size and quantity
   — the two magnitude dimensions — which are relational and come last.
   ============================================================ */

const PROG_STREAMS = [
  { key:'position', mode:'relational' },
  { key:'pitch',    mode:'identity'   },
  { key:'color',    mode:'identity'   },
  { key:'glyph',    mode:'identity'   },
  { key:'pan',      mode:'identity'   },
  { key:'timbre',   mode:'identity'   },
  { key:'size',     mode:'relational' },
  { key:'quantity', mode:'relational' },
];

const ADVANCE_AT = 0.85;   // block score that earns a speed-up (fixed-step mode)
const DEMOTE_AT  = 0.70;   // block score that forces a slow-down (fixed-step mode)

/* ============================================================
   2a. BAYESIAN ADAPTIVE STAIRCASE

   A QUEST/ZEST-style grid posterior over the player's speed threshold, replacing the
   fixed ±0.25s rule. Estimating the threshold directly means the interval is placed
   where it is most informative instead of walked there, and — the bigger win — the
   posterior CARRIES ACROSS milestones, so clearing one no longer discards every block
   of evidence and drops you back to 5.00s.

   The grid is over T = log10(interval) at which the player scores `pTarget`. Working
   in the threshold parameter rather than the curve's midpoint keeps every quantity
   here directly interpretable: T is a number of milliseconds you can print.

   Chance correction (§9) is what makes one model work at every milestone: because a
   passive player scores 0 and a perfect one 1 regardless of stream count or N, the
   guess rate drops out and there is no per-configuration constant to keep in sync.
   ============================================================ */

const STAIR = {
  /* The grid must extend well past the prior's mass in BOTH directions: truncating a
     tail biases the posterior mean toward the surviving side, which showed up as a
     fresh player being placed at 3.99s when the prior said 5.00s. */
  lo: 2.85, hi: 4.20, steps: 136,   // log10 ms: 708ms … 15.8s
  beta: 6.0,                        // slope, log10 units
  lapse: 0.03,                      // attention lapses; without it one bad block bites hard
  pTarget: 0.80,                    // performance the interval is placed at
  /* Posterior tempering. The threshold MOVES as the player learns, so an untempered
     posterior gets steadily overconfident and lags reality. Swept empirically: 1.00
     lags a fast learner by 40%, 0.92 by 27%, 0.85 by 13% — and past 0.85 the returns
     collapse while estimate noise and bias keep climbing. */
  forget: 0.85,
  clearAt: 0.90,                    // posterior mass below target needed to clear
  priorSigma: 0.22,                 // ±1σ ≈ 3.0s … 8.3s for a 5s prior
  carryWiden: 1.6,                  // variance inflation when the task changes
  carryShift: { spin: 0.04, n: 0.12, stimulus: 0.15 },   // log10 ms, harder ⇒ slower
};

const T_GRID = Array.from({ length: STAIR.steps }, (_, i) =>
  STAIR.lo + (STAIR.hi - STAIR.lo) * i / (STAIR.steps - 1));
const T_STEP = (STAIR.hi - STAIR.lo) / (STAIR.steps - 1);

/* Offset that makes psi(T) == pTarget exactly, so the grid parameter IS the threshold. */
const STAIR_C = Math.log(STAIR.pTarget / ((1 - STAIR.lapse) - STAIR.pTarget));
const psi = (x, T) => (1 - STAIR.lapse) /
                      (1 + Math.exp(-(STAIR.beta * (x - T) + STAIR_C)));

let stairLog = null;      // unnormalised log posterior over T_GRID

function stairInit(thresholdMs, sigma) {
  const c = Math.log10(thresholdMs);
  const s = sigma || STAIR.priorSigma;
  stairLog = T_GRID.map(t => -0.5 * ((t - c) / s) ** 2);
  stairNormalise();
}

function stairNormalise() {
  const m = Math.max(...stairLog);
  let sum = 0;
  const p = stairLog.map(l => { const e = Math.exp(l - m); sum += e; return e; });
  stairLog = p.map(v => Math.log(Math.max(v / sum, 1e-300)));
  return p.map(v => v / sum);
}

const stairPost = () => stairNormalise();

function stairMeanT() {
  const p = stairPost();
  return T_GRID.reduce((s, t, i) => s + t * p[i], 0);
}

const stairThresholdMs = () => Math.pow(10, stairMeanT());

/* Temper the posterior: p^f, renormalised. f<1 widens. Used both for forgetting
   (the threshold drifts as the player learns) and for carry-time uncertainty. */
function stairTemper(f) {
  stairNormalise();
  stairLog = stairLog.map(l => l * f);
  stairNormalise();
}

/* One block = one observation of k successes in n trials at intensity x. */
function stairObserve(x, k, n) {
  if (!stairLog) stairInit(tune.startInterval);
  stairLog = stairLog.map((l, i) => {
    const p = Math.min(1 - 1e-6, Math.max(1e-6, psi(x, T_GRID[i])));
    return l + k * Math.log(p) + (n - k) * Math.log(1 - p);
  });
  stairTemper(STAIR.forget);
}

/* Place the next block where the fitted curve predicts pTarget — i.e. at the
   threshold itself, which is what the grid parameter already is. */
function stairNextInterval() {
  const ms = Math.pow(10, stairMeanT());
  const lo = Math.max(700, tune.targetInterval * 0.75);
  return Math.round(Math.min(tune.maxInterval, Math.max(lo, ms)) / 10) * 10;
}

/* Milestone criterion: enough posterior mass at or below the target interval. */
function stairMassBelow(ms) {
  const p = stairPost(), xt = Math.log10(ms);
  return T_GRID.reduce((s, t, i) => s + (t <= xt ? p[i] : 0), 0);
}
const stairCleared = ms => stairMassBelow(ms) >= STAIR.clearAt;

/* Central credible interval, for the report card. */
function stairCI(mass) {
  const p = stairPost(), tail = (1 - (mass || 0.9)) / 2;
  let c = 0, lo = T_GRID[0], hi = T_GRID[T_GRID.length - 1];
  for (let i = 0; i < p.length; i++) {
    const prev = c; c += p[i];
    if (prev < tail && c >= tail) lo = T_GRID[i];
    if (prev < 1 - tail && c >= 1 - tail) { hi = T_GRID[i]; break; }
  }
  return [Math.pow(10, lo), Math.pow(10, hi)];
}

/* Shift the whole posterior along the grid by `s` log10-units, linearly
   interpolated. Mass pushed off the end is dropped and renormalised away. */
function stairShift(s) {
  const p = stairPost(), cells = s / T_STEP;
  const out = T_GRID.map((_, i) => {
    const src = i - cells, f = Math.floor(src), frac = src - f;
    let v = 0;
    if (f >= 0 && f < p.length) v += p[f] * (1 - frac);
    if (f + 1 >= 0 && f + 1 < p.length) v += p[f + 1] * frac;
    return v;
  });
  const sum = out.reduce((a, b) => a + b, 0) || 1;
  stairLog = out.map(v => Math.log(Math.max(v / sum, 1e-300)));
}

/* Carry across a milestone: the new task is harder, so the threshold moves slower —
   and we are less certain about it than we were a moment ago. */
function stairCarry(kind, backwards) {
  const s = STAIR.carryShift[kind] || 0.1;
  stairShift(backwards ? -s : s);
  stairTemper(1 / STAIR.carryWiden);
}

/* Which digit of the odometer is about to roll, so carry can size the shift. */
function carryKind(p) {
  const levels = spinLevels();
  if (p.spinLevel === 0) return p.n < 2 ? 'n' : 'stimulus';   // rotation entering = major
  if (p.spinLevel < levels.length - 1) return 'spin';
  if (p.n < tune.nMax) return 'n';
  return 'stimulus';
}

/* Pooled chance-corrected judgment rate. The displayed block score is a weakest-link
   blend (0.6·mean + 0.4·min), which is NOT a proportion and has no business in a
   binomial likelihood — so the staircase gets this instead. */
function pooledRate() {
  const ts = Object.values(state.tally).filter(t => t.total);
  if (!ts.length) return 0;
  const ok = ts.reduce((s, t) => s + t.ok, 0);
  const tot = ts.reduce((s, t) => s + t.total, 0);
  /* Weight each stream's own chance level by how many judgments it contributed. */
  const chance = ts.reduce((s, t) => s + chanceOf(t) * t.total, 0) / tot;
  if (chance >= 0.999) return 0;
  return Math.max(0, (ok / tot - chance) / (1 - chance));
}

/* Rotation periods in seconds/turn, slowest → fastest. Index 0 is a still cube. */
function spinLevels() {
  const out = [0];
  const { spinStart, spinEnd, spinStep } = tune;
  for (let s = spinStart; s >= spinEnd - 1e-9; s -= spinStep) out.push(Math.round(s));
  if (out.length === 1) out.push(spinStart);
  return out;
}

/* The carry rules, exactly as laid out:
     · still cube: N climbs 1 → 2
     · then rotation is introduced and N resets to 1
     · rotation speeds up step by step at fixed N
     · at top rotation speed: N + 1, rotation back to slowest
     · past max N: add a stimulus, N back to `nAfterStimulus`, rotation to slowest */
function advanceLadder(p) {
  const levels = spinLevels();
  if (p.spinLevel === 0) {
    if (p.n < 2) p.n++;
    else { p.spinLevel = 1; p.n = 1; }
  } else if (p.spinLevel < levels.length - 1) {
    p.spinLevel++;
  } else if (p.n < tune.nMax) {
    p.n++; p.spinLevel = 1;
  } else if (p.streamCount < PROG_STREAMS.length) {
    p.streamCount++; p.n = Math.min(tune.nAfterStimulus, tune.nMax); p.spinLevel = 1;
  } else {
    return false;                     // ladder complete
  }
  p.interval = tune.startInterval;
  return true;
}

function regressLadder(p) {
  const levels = spinLevels();
  if (p.spinLevel === 0) {
    if (p.n > 1) p.n--; else return false;
  } else if (p.spinLevel > 1) {
    p.spinLevel--;
  } else if (p.n > 1) {
    p.n--; p.spinLevel = levels.length - 1;
  } else if (p.streamCount > 1) {
    p.streamCount--; p.n = tune.nMax; p.spinLevel = levels.length - 1;
  } else {
    p.spinLevel = 0; p.n = 2;
  }
  p.interval = tune.startInterval;
  return true;
}

/* What clearing the current milestone will unlock. Drives the "next up" line, which
   is the whole point of the ladder feeling intuitive — you always know the goal. */
function describeNext(p) {
  const levels = spinLevels();
  if (p.spinLevel === 0) {
    if (p.n < 2) return { what: `N rises to 2`, why: 'still no rotation — just a longer gap to hold' };
    return { what: `the cube starts rotating`, why: `slowly, one turn per ${levels[1]}s — and N drops back to 1` };
  }
  if (p.spinLevel < levels.length - 1)
    return { what: `rotation speeds up to ${levels[p.spinLevel + 1]}s per turn`, why: 'same N, less stable frame' };
  if (p.n < tune.nMax)
    return { what: `N rises to ${p.n + 1}`, why: 'rotation resets to slowest' };
  if (p.streamCount < PROG_STREAMS.length) {
    const nx = PROG_STREAMS[p.streamCount];
    return { what: `${STREAMS[nx.key].label} joins (${nx.mode})`,
             why: `N drops to ${Math.min(tune.nAfterStimulus, tune.nMax)}, rotation resets` };
  }
  return { what: 'the ladder is complete', why: 'switch to Free Play to keep pushing Load' };
}

/* Position on the ladder, found by replaying it from the start. Cheaper than a
   closed-form index and impossible to get out of sync with advanceLadder. */
function ladderPosition() {
  const start = { streamCount:1, n:1, spinLevel:0, interval:tune.startInterval };
  const same = (a, b) => a.streamCount === b.streamCount && a.n === b.n && a.spinLevel === b.spinLevel;
  const p = { ...start };
  let index = 0, total = 0, found = -1;
  for (let i = 0; i < 5000; i++) {
    if (same(p, prog)) found = index;
    total = ++index;
    if (!advanceLadder(p)) break;
  }
  return { index: (found < 0 ? 0 : found) + 1, total };
}

