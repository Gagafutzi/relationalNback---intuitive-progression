"use strict";

/* ============================================================
   9. JUDGMENTS
   ============================================================ */

/* Cardinal direction between two cells as [axis, sign], or null if not axis-aligned. */
function cardinalOf(a, b) {
  const ca = state.cells[a.cellIdx], cb = state.cells[b.cellIdx];
  const d = [cb.x - ca.x, cb.y - ca.y, cb.z - ca.z];
  const nz = d.map((v, i) => [v, i]).filter(([v]) => v !== 0);
  return nz.length === 1 ? [nz[0][1], Math.sign(nz[0][0])] : null;
}

function buildJudgments(a, b, extra) {
  const js = [];
  const mode = k => cfg.streams[k] || 'off';
  const push = (stream, options, correct) => js.push({ stream, options, correct });
  const axisJ = (stream, v, ids) => {
    push(stream, [ids[0], ids[1]], v > EPS ? [ids[0]] : v < -EPS ? [ids[1]] : []);
  };

  /* --- position --- */
  if (cfg.meta && mode('position') === 'relational') {
    /* Second order: how does this move relate to the previous one? Only defined
       once there IS a previous move, so the first comparison of a block is skipped. */
    const prev = extra && extra.metaPrev;
    if (prev) {
      const A = cardinalOf(prev[0], prev[1]), B = cardinalOf(a, b);
      if (A && B) {
        const same = A[0] === B[0] && A[1] === B[1];
        const opp  = A[0] === B[0] && A[1] !== B[1];
        push('position', ['meta-same', 'meta-opp', 'meta-diff'],
             [same ? 'meta-same' : opp ? 'meta-opp' : 'meta-diff']);
      }
    }
  } else if (mode('position') === 'identity') {
    push('position', ['pos'], a.cellIdx === b.cellIdx ? ['pos'] : []);
  } else if (mode('position') === 'relational') {
    const ca = state.cells[a.cellIdx], cb = state.cells[b.cellIdx];
    const raw = [cb.x - ca.x, cb.y - ca.y, cb.z - ca.z];

    if (cfg.frame === 'cube' || cfg.frame === 'both') {
      const v = normalise(raw);
      axisJ('position', v[0], ['east', 'west']);
      axisJ('position', v[1], ['south', 'north']);
      axisJ('position', v[2], ['above', 'below']);
    }
    if (cfg.frame === 'screen' || cfg.frame === 'both') {
      const v = normalise(projectScreen(raw, b.matrix));
      axisJ('position2', v[0], ['s-east', 's-west']);
      axisJ('position2', v[1], ['s-south', 's-north']);
      axisJ('position2', v[2], ['s-near', 's-far']);
    }
  }

  /* --- ordered scalar features --- */
  const scalar = (key, idCommon, idUp, idDown) => {
    const m = mode(key);
    if (m === 'off' || a[key] == null || b[key] == null) return;
    if (m === 'identity') push(key, [idCommon], a[key] === b[key] ? [idCommon] : []);
    else push(key, [idUp, idDown], b[key] > a[key] ? [idUp] : b[key] < a[key] ? [idDown] : []);
  };
  scalar('pitch',    'pitch',  'pitch-up',   'pitch-down');
  scalar('timbre',   'timbre', 'timbre-up',  'timbre-down');
  scalar('pan',      'pan',    'pan-right',  'pan-left');
  scalar('color',    'color',  'color-cool', 'color-warm');  // pool runs warm → cool
  scalar('size',     'size',   'size-up',    'size-down');
  scalar('quantity', 'qty',    'qty-up',     'qty-down');
  /* No up/down pair: `letter` is registered identity-only and its settings row offers
     no relational option, so the scalar helper's ordered branch is unreachable here. */
  if (mode('letter') === 'identity' && a.letter != null && b.letter != null)
    push('letter', ['letter'], a.letter === b.letter ? ['letter'] : []);

  /* --- glyph: identity, or movement across the 2×2 set map + rank --- */
  const gm = mode('glyph');
  if (gm !== 'off' && a.glyphSet != null && b.glyphSet != null) {
    if (gm === 'identity') {
      const same = a.glyphSet === b.glyphSet && a.glyphIdx === b.glyphIdx;
      push('glyph', ['glyph'], same ? ['glyph'] : []);
    } else {
      const pa = state.glyphMap[GLYPH_SET_KEYS[a.glyphSet]];
      const pb = state.glyphMap[GLYPH_SET_KEYS[b.glyphSet]];
      push('glyph', ['glyph-east','glyph-west'],
        pb.x > pa.x ? ['glyph-east'] : pb.x < pa.x ? ['glyph-west'] : []);
      push('glyph', ['glyph-south','glyph-north'],
        pb.y > pa.y ? ['glyph-south'] : pb.y < pa.y ? ['glyph-north'] : []);
      push('glyph', ['glyph-up','glyph-down'],
        b.glyphIdx > a.glyphIdx ? ['glyph-up'] : b.glyphIdx < a.glyphIdx ? ['glyph-down'] : []);
    }
  }
  return js;
}

/* The tally update is written as a signed fold so it can also be run backwards.
   A press that lands just after the stimulus changed was aimed at the trial that
   just left the screen (see press()); crediting it means unapplying the closed
   interval, adding the press, and applying it again. */
function applyInterval(snap, sign) {
  const { judgments, presses, isLure } = snap;
  judgments.forEach(j => {
    const t = state.tally[j.stream] ||
      (state.tally[j.stream] = { ok:0, total:0, empty:0, sigs:{}, hit:0, miss:0, fa:0, cr:0 });
    if (!j.correct.length) t.empty += sign;
    /* Histogram of correct-answer patterns. Chance is the best CONSTANT strategy,
       which is "always answer the most common thing" — that equals the never-press
       rate only when a never-press answer exists. Meta-relations always has exactly
       one correct answer, so its true chance is the modal answer's share (~2/3),
       not 0. */
    const sig = j.correct.slice().sort().join('|');
    t.sigs[sig] = (t.sigs[sig] || 0) + sign;
    let exact = true;
    j.options.forEach(o => {
      const target = j.correct.includes(o);
      const pressed = presses.has(o);
      if (target && pressed) t.hit += sign;
      else if (target && !pressed) { t.miss += sign; exact = false; }
      else if (!target && pressed) { t.fa += sign; exact = false; }
      else t.cr += sign;
    });
    t.total += sign;
    if (exact) t.ok += sign;
  });

  /* Lure trials get their own tally. Adapting the lure rate on OVERALL accuracy
     would just re-measure what the interval staircase already measures, and the two
     would fight over the same evidence; lure resistance is a separate signal. */
  if (isLure) {
    const lt = state.lureTally || (state.lureTally = { ok:0, total:0, empty:0, sigs:{} });
    judgments.forEach(j => {
      if (!j.correct.length) lt.empty += sign;
      const sig = j.correct.slice().sort().join('|');
      lt.sigs[sig] = (lt.sigs[sig] || 0) + sign;
      const exact = j.options.every(o => j.correct.includes(o) === presses.has(o));
      lt.total += sign;
      if (exact) lt.ok += sign;
    });
  }
  state.scored += sign;
}

const snapMissed = snap =>
  snap.judgments.some(j => j.correct.some(o => !snap.presses.has(o)));

function scoreInterval() {
  /* Reset before the guard: a priming trial with no judgments must not inherit the
     previous interval's result. */
  state.lastSnap = null;
  if (!state.judgments.length) return;
  /* The press set is copied — the live one is cleared for the incoming trial, but
     this one has to stay editable for the length of the grace window. */
  const snap = {
    judgments: state.judgments,
    presses: new Set(state.presses),
    trial: state.trial,
    stimAt: state.stimAt,
    isLure: !!(state.currentTrial && state.currentTrial.isLure),
  };
  applyInterval(snap, 1);
  state.lastSnap = snap;
}

/* Chance-corrected accuracy restricted to lure trials. */
function lureScore() {
  const lt = state.lureTally;
  if (!lt || lt.total < LURE_MIN_TRIALS) return null;
  const chance = chanceOf(lt);
  if (chance >= 0.999) return 0;
  return Math.max(0, (lt.ok / lt.total - chance) / (1 - chance));
}

/* Raw accuracy: the fraction of judgments answered exactly right. Intuitive, but its
   chance level moves with the stream — pressing nothing scores ~72% on an identity
   stream (28% target rate) and ~33% on a 3-way relational axis. */
const rawAcc = t => t.total ? t.ok / t.total : 0;

/* Chance-corrected score, on a scale where "never press" = 0 and perfect = 1.
   `empty/total` IS the score a passive player would get, measured from the block's
   own base rates — so one fixed threshold means the same thing at every milestone. */
const chanceOf = t => !t.total ? 1
  : Math.max(...Object.values(t.sigs || { '': t.empty })) / t.total;

function streamScore(t) {
  if (!t.total) return 0;
  const chance = chanceOf(t);
  if (chance >= 0.999) return 0;
  return Math.max(0, (rawAcc(t) - chance) / (1 - chance));
}

/* Mostly the mean, partly the weakest stream, so you can't win by abandoning one.
   When a stream is cued for priority this block, it carries extra weight — but the
   weakest-link term stays, because variable-priority training means "prioritise X
   WITHOUT dropping the rest", not "ignore the rest". */
function blockScore() {
  const entries = Object.entries(state.tally).filter(([, t]) => t.total);
  if (!entries.length) return 0;
  const scores = entries.map(([, t]) => streamScore(t));
  const mean = scores.reduce((s, a) => s + a, 0) / scores.length;
  const min = Math.min(...scores);

  const cued = state.priorityStream;
  const cuedEntry = cued && entries.find(([k]) => k === cued);
  if (!cuedEntry || entries.length < 2) return 0.6 * mean + 0.4 * min;

  return 0.40 * streamScore(cuedEntry[1]) + 0.35 * mean + 0.25 * min;
}

