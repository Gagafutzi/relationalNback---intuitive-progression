"use strict";

/* ============================================================
   8. TRIAL GENERATION
   ============================================================ */

const randInt = n => Math.floor(Math.random() * n);
const pick = a => a[randInt(a.length)];

/* Lure budget for the trial being sampled. Decided ONCE per trial and assigned to a
   single stream: letting every active stream roll independently makes the observed
   rate compound with stream count (30% configured read as 44% with two streams), so
   the axis would mean something different at every milestone. */
let usedLure = false;
let lureTarget = null;

/* Index sampler with controlled target and lure rates. */
function sampleIndex(streamKey, len, nbackIdx, lureIdxs) {
  /* Lure is checked BEFORE the target-match roll. A lure is by definition not an
     n-back match, so rolling for a match first would silently eat the lure on 28% of
     the trials that were chosen to carry one. */
  const lures = (lureIdxs || []).filter(i => i != null && i !== nbackIdx);
  if (lures.length && lureTarget === streamKey) {
    lureTarget = null; usedLure = true;
    return pick(lures);
  }
  if (nbackIdx != null && Math.random() < TARGET_RATE) return nbackIdx;
  let i, guard = 0;
  do { i = randInt(len); guard++; } while (i === nbackIdx && guard < 20 && len > 1);
  return i;
}

/* Counts back through the ADMITTED chain, not every trial shown. With gating on,
   a compare-only trial never becomes anybody's n-back item. */
function backAt(k) {
  const c = state.chain;
  return k >= 1 && c.length >= k ? c[c.length - k] : null;
}

/* Cells reachable from `from` by a single-axis move — meta-relations needs every
   delta to be cardinal, or "same/opposite/different" has no defined answer for a
   diagonal move and the task stops being about memory. */
function cardinalNeighbours(fromIdx) {
  const f = state.cells[fromIdx];
  return state.cells.map((c, i) => ({ c, i })).filter(({ c }) => {
    const d = [c.x - f.x, c.y - f.y, c.z - f.z];
    const nz = d.filter(v => v !== 0).length;
    return nz === 1;
  }).map(({ i }) => i);
}

/* Choose the next cell by which meta-relation it should realise, uniformly over the
   types actually reachable from here. `A` is the previous move as [axis, sign]. */
function pickMetaTarget(fromIdx, A) {
  const neigh = cardinalNeighbours(fromIdx);
  if (!A || !neigh.length) return neigh.length ? pick(neigh) : randInt(state.cells.length);
  const f = state.cells[fromIdx];
  const byType = { same: [], opp: [], diff: [] };
  neigh.forEach(i => {
    const c = state.cells[i];
    const d = [c.x - f.x, c.y - f.y, c.z - f.z];
    const ax = d.findIndex(v => v !== 0);
    if (ax === A[0]) (Math.sign(d[ax]) === A[1] ? byType.same : byType.opp).push(i);
    else byType.diff.push(i);
  });
  /* "Same" means continuing straight, which a wall blocks about half the time, so
     uniform-over-available leaves it at ~11%. Over-weight it when it IS reachable to
     pull the three answers closer together. */
  const W = { same: 3, opp: 1, diff: 1 };
  const avail = ['same', 'opp', 'diff'].filter(k => byType[k].length);
  let r = Math.random() * avail.reduce((s, k) => s + W[k], 0);
  const type = avail.find(k => (r -= W[k]) < 0) || avail[avail.length - 1];
  return pick(byType[type]);
}

function sampleTrial() {
  const n = cfg.n;
  const nb = backAt(n);
  const lureA = backAt(n - 1), lureB = backAt(n + 1);
  const rel = k => cfg.streams[k] === 'relational';
  const on  = k => cfg.streams[k] && cfg.streams[k] !== 'off';
  const t = {};
  usedLure = false;
  /* One lure per trial at most, on a randomly chosen stream that can actually carry
     one. Relational feature streams sample freely and have no lure concept, so
     targeting them would silently waste the trial's lure budget. */
  const eligible = STREAM_KEYS.filter(k =>
    on(k) && (cfg.streams[k] === 'identity' || k === 'position'));
  lureTarget = (eligible.length && Math.random() < cfg.lureRate) ? pick(eligible) : null;

  /* Identity mode needs forced matches (1/27 is far too rare otherwise);
     relational mode is dense by construction, so sample freely. */
  if (cfg.meta && rel('position') && nb) {
    /* Every delta cardinal, so both first-order directions are unambiguous — and the
       target is chosen by RELATION type, not by neighbour. Sampling neighbours
       uniformly yields same 5% / opposite 28% / different 66%, because four of six
       directions leave the axis and walls block continuing straight; "always answer
       different" would then score 66%. */
    t.cellIdx = pickMetaTarget(nb.cellIdx, nb.pair ? cardinalOf(nb.pair[0], nb.pair[1]) : null);
  } else if (rel('position') && nb && lureTarget === 'position') {
    /* Relational lure: make the move from the (n−1)-back item clean and cardinal,
       so mis-counting your lag yields a confident WRONG answer rather than noise.
       Without this the lure axis would do nothing until identity streams appear. */
    const cand = lureA ? cardinalNeighbours(lureA.cellIdx)
                          .filter(i => i !== nb.cellIdx) : [];
    if (cand.length) { t.cellIdx = pick(cand); usedLure = true; lureTarget = null; }
    else t.cellIdx = randInt(state.cells.length);
  } else if (rel('position') || !on('position')) {
    t.cellIdx = randInt(state.cells.length);
  } else {
    t.cellIdx = sampleIndex('position', state.cells.length, nb ? nb.cellIdx : null,
                            [lureA && lureA.cellIdx, lureB && lureB.cellIdx]);
  }

  const feature = (key, pool) => {
    if (!on(key)) return null;
    if (rel(key)) return randInt(pool.length);
    return sampleIndex(key, pool.length, nb ? nb[key] : null,
                       [lureA && lureA[key], lureB && lureB[key]]);
  };

  t.pitch    = feature('pitch',    PITCHES);
  t.timbre   = feature('timbre',   TIMBRES);
  t.pan      = feature('pan',      PANS);
  t.color    = feature('color',    COLORS);
  t.size     = feature('size',     SIZES);
  t.quantity = feature('quantity', COUNTS);

  if (on('glyph')) {
    if (rel('glyph')) {
      t.glyphSet = randInt(GLYPH_SET_KEYS.length);
      t.glyphIdx = randInt(5);
    } else {
      /* Glyph builds its value from two fields, so it can't use sampleIndex — it
         needs its own lure branch, or targeting it silently wastes the trial's
         lure budget. */
      const cands = [lureA, lureB].filter(x => x && x.glyphSet != null &&
        !(nb && x.glyphSet === nb.glyphSet && x.glyphIdx === nb.glyphIdx));
      if (lureTarget === 'glyph' && cands.length) {
        const L = pick(cands);
        t.glyphSet = L.glyphSet; t.glyphIdx = L.glyphIdx;
        lureTarget = null; usedLure = true;
      } else {
        const same = nb && nb.glyphSet != null && Math.random() < TARGET_RATE;
        t.glyphSet = same ? nb.glyphSet : randInt(GLYPH_SET_KEYS.length);
        t.glyphIdx = same ? nb.glyphIdx : randInt(5);
      }
    }
  } else { t.glyphSet = null; t.glyphIdx = null; }

  t.isLure = usedLure;
  /* Gate: a compare-only trial must still be judged, but never joins the chain.
     Never close the gate before there is a chain to protect. */
  t.gate = (cfg.gate > 0 && state.chain.length > cfg.n && Math.random() < cfg.gate)
    ? 'compare' : 'update';
  return t;
}

function renderTrial(t) {
  clearCells();
  state.stimShown = true;
  const cell = state.cells[t.cellIdx];
  cell.el.classList.add('active');
  if (t.gate === 'compare') cell.el.classList.add('gate-closed');
  $('gateBanner').classList.toggle('show', t.gate === 'compare');
  positionGuides(t.cellIdx);
  const faces = cell.el.querySelectorAll('.cell-face');

  const glyphChar = t.glyphSet != null ? GLYPH_SETS[GLYPH_SET_KEYS[t.glyphSet]][t.glyphIdx] : null;

  /* The SIZES ladder is tuned for a roomy cell; a 4³ cube (or a small viewport) makes
     cells small enough that the largest size plus a quantity row overflows the face.
     Scale the whole ladder rather than clamping it — clamping would collapse adjacent
     size levels into each other and make the size judgement unanswerable. */
  const cellPx = (gridCube.clientWidth || 240) / cfg.dim;
  const maxFont = (cellPx - 4) / (t.quantity != null ? 1.4 : 1.1);
  const scale = Math.min(1, maxFont / SIZES[SIZES.length - 1]);
  const fontSize = (t.size != null ? SIZES[t.size] : 26) * scale;

  /* Quantity gets its own marker row rather than repeating the glyph — repeating a
     multi-character glyph like "III" three times is unreadable. */
  let html = '';
  if (glyphChar) html += `<span class="g" style="font-size:${fontSize}px">${glyphChar}</span>`;
  if (t.quantity != null) {
    const dots = '●'.repeat(COUNTS[t.quantity]);
    const qs = glyphChar ? Math.max(7, fontSize * 0.32) : Math.max(9, fontSize * 0.55);
    html += `<span class="q" style="font-size:${qs}px">${dots}</span>`;
  }
  if (!glyphChar && t.quantity == null && t.size != null)
    html = `<span class="g" style="font-size:${fontSize}px">●</span>`;

  faces.forEach(f => {
    if (t.color != null) f.style.background = COLORS[t.color];
    f.innerHTML = html;
  });

  if (t.pitch != null || t.timbre != null || t.pan != null) playTone(t);
  t.matrix = currentMatrix();
}

function clearCells() {
  state.stimShown = false;
  $('gateBanner').classList.remove('show');
  state.cells.forEach(c => {
    c.el.classList.remove('active', 'gate-closed');
    c.el.querySelectorAll('.cell-face').forEach(f => {
      f.style.background = ''; f.innerHTML = '';
    });
  });
}

/* Deliberately below the stimulus pitches (220–523 Hz) and harsher than any of them,
   so it can never be mistaken for a trial tone. */
function playBuzz(kind) {
  if (!cfg.buzzer) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  const pulse = (at, dur, peak) => {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  };

  if (kind === 'miss') {
    /* A miss and a wrong press are opposite mistakes and need opposite corrections,
       so they get different sounds rather than leaving you to guess which one you
       just made. Two flat low pulses vs the single descending slide. */
    osc.frequency.setValueAtTime(112, t0);
    pulse(t0, 0.07, 0.055);
    pulse(t0 + 0.10, 0.07, 0.055);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + 0.20);
  } else {
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(96, t0 + 0.14);
    pulse(t0, 0.16, 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0); osc.stop(t0 + 0.18);
  }
}

function playTone(t) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = t.timbre != null ? TIMBRES[t.timbre] : 'sine';
  osc.frequency.value = t.pitch != null ? PITCHES[t.pitch] : 330;
  gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.09, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.30);

  let tail = gain;
  if (t.pan != null && audioCtx.createStereoPanner) {
    const p = audioCtx.createStereoPanner();
    p.pan.value = PANS[t.pan];
    gain.connect(p); tail = p;
  }
  osc.connect(gain); tail.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.32);
}

