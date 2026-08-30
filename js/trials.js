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

/* ---- Variable N ----
   The deepest lag the current settings can ask for. Anything sized against "how far
   back might this block reach" has to use this rather than cfg.n, or it reserves
   room for the centre of the range and the top of it goes unprotected. */
const maxLag = () => cfg.n + (cfg.varN || 0);

/* The lag THIS trial is judged at, drawn fresh per trial and then carried on the
   trial itself. Fixed N is just the zero-spread case.

   The draw is clamped to the chain that actually exists, which matters at the start
   of a block: an uncued 4-back over two items has no answer, and cueing one would be
   asking a question the player cannot be wrong about. Early trials therefore run
   shallow and deepen as the chain fills, the same warm-up fixed N already has.

   Sampling here rather than in tick() is deliberate — the whole point of knowing the
   lag before the stimulus is chosen is that targets and lures can be planted AT that
   lag. Deciding it afterwards would leave a variable-N block with no targets. */
function trialLag() {
  if (!cfg.varN) return cfg.n;
  const hi = Math.min(cfg.n + cfg.varN, Math.max(1, state.chain.length));
  const lo = Math.min(Math.max(1, cfg.n - cfg.varN), hi);
  return lo + randInt(hi - lo + 1);
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
  const n = trialLag();
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
  t.timbre   = feature('timbre',   voiceSet().voices);
  t.pan      = feature('pan',      PANS);
  t.color    = feature('color',    COLORS);
  t.size     = feature('size',     SIZES);
  t.quantity = feature('quantity', COUNTS);
  t.letter   = feature('letter',   LETTER_KEYS);

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
  /* The lag this trial was built around. tick() reads it back to pick the partner,
     so the judgement is scored against the same item the stimulus was sampled
     against — and the cue shows the player the same number. */
  t.n = n;
  /* Gate: a compare-only trial must still be judged, but never joins the chain.
     Never close the gate before there is a chain to protect — measured at the
     DEEPEST lag in play, since eating an item the top of the range still needs would
     strand those trials. */
  t.gate = (cfg.gate > 0 && state.chain.length > maxLag() && Math.random() < cfg.gate)
    ? 'compare' : 'update';
  return t;
}

function renderTrial(t) {
  clearCells();
  showLagCue(t);
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
    if (t.color != null) litColour(f, COLORS[t.color]);
    f.innerHTML = html;
  });

  /* A letter carries the trial's audio on its own; the tone is only for the streams
     that have no voice. Pan applies to whichever is sounding. */
  if (t.pitch != null || t.timbre != null || (t.pan != null && t.letter == null))
    playTone(t);
  if (t.letter != null) playLetter(t);
  t.matrix = currentMatrix();
}

/* Repaint the lit slot from the colour stream by overriding the same variables the
   theme sets on :root, so fill, edge, halo and ink move together. Without this the
   halo keeps the accent's hue whatever colour the slot is, and a red face inside a
   cyan glow reads as neither.

   The ink is chosen by comparing actual contrast against both candidates rather than
   by a luma threshold. appearance.js's `luma` is the right tool for the accent, but it
   is unlinearised, and the palette's red lands just the wrong side of 0.5 — which gave
   white glyphs on red at a ratio of 2:1. */
const LIT_VARS = ['--cell-active', '--cell-active-solid', '--cell-active-edge',
                  '--cell-glow', '--cell-ink'];
const srgbLum = c => {
  const [r, g, b] = rgbOf(c).map(v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const INK_DARK = '#08131a', INK_LIGHT = '#ffffff';

function litColour(face, hex) {
  const L = srgbLum(hex);
  const ratio = o => (Math.max(L, o) + 0.05) / (Math.min(L, o) + 0.05);
  face.style.setProperty('--cell-active', hex);
  face.style.setProperty('--cell-active-solid', hex);
  face.style.setProperty('--cell-active-edge', lighten(hex, 0.45));
  /* Weaker than the accent's 0.8: a saturated hue under a bright halo of its own
     colour washes out, and the hue is the thing being reported. */
  face.style.setProperty('--cell-glow', rgba(hex, 0.55));
  face.style.setProperty('--cell-ink',
    ratio(srgbLum(INK_DARK)) >= ratio(srgbLum(INK_LIGHT)) ? INK_DARK : INK_LIGHT);
}

/* The cue is the trial's instruction, not part of the stimulus, so it stays up for
   the whole interval — including the stretch after a retro trial blanks the cube.
   The restart of the flash animation is what makes a repeated lag read as a fresh
   instruction rather than as last trial's cue still sitting there. */
function showLagCue(t) {
  const el = $('nbackCue');
  if (!cfg.varN || t.n == null) { el.classList.remove('show'); return; }
  $('nbackCueN').textContent = t.n;
  el.classList.remove('show');
  void el.offsetWidth;                 // reflow, or the animation never replays
  el.classList.add('show');
}

const hideLagCue = () => $('nbackCue').classList.remove('show');

function clearCells() {
  state.stimShown = false;
  $('gateBanner').classList.remove('show');
  state.cells.forEach(c => {
    c.el.classList.remove('active', 'gate-closed');
    c.el.querySelectorAll('.cell-face').forEach(f => {
      f.style.background = ''; f.innerHTML = '';
      LIT_VARS.forEach(k => f.style.removeProperty(k));
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

/* PeriodicWave objects are immutable and shared, so building one per trial allocates
   for nothing. */
const waveCache = new Map();
function voiceWave(ctx, partials) {
  const key = partials.join(',');
  let w = waveCache.get(key);
  if (!w) {
    const real = new Float32Array(partials.length + 1);
    const imag = new Float32Array(partials.length + 1);
    partials.forEach((a, i) => { imag[i + 1] = a; });
    w = ctx.createPeriodicWave(real, imag);
    waveCache.set(key, w);
  }
  return w;
}

/* Split out of playTone so a voice can be rendered into an OfflineAudioContext and
   measured — which is how the brightness ordering above was established. */
function buildVoice(ctx, v, freq, out, t0) {
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  if (v.partials) osc.setPeriodicWave(voiceWave(ctx, v.partials));
  else osc.type = v.osc || 'sine';

  if (v.formants) {
    /* Parallel resonances on a buzzy source, summed: that is what makes a vowel. */
    v.formants.forEach(([ratio, q, g]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = ratio * freq; bp.Q.value = q;
      const fg = ctx.createGain(); fg.gain.value = g;
      osc.connect(bp); bp.connect(fg); fg.connect(out);
    });
  } else {
    osc.connect(out);
  }
  osc.start(t0);
  return osc;
}

/* Decoded clips, keyed voice/letter. Decoding is async, so it is kicked off when the
   stream is switched on rather than on the trial that needs it — a letter arriving
   after its own trial has ended is worse than no letter. */
const letterBuffers = new Map();
function primeLetters() {
  if (!cfg.streams.letter || cfg.streams.letter === 'off') return;
  const vs = cfg.letterVoice === 'mix' ? Object.keys(LETTER_VOICES) : [cfg.letterVoice];
  vs.forEach(v => LETTER_KEYS.forEach(L => {
    const k = v + '/' + L;
    if (letterBuffers.has(k) || !LETTER_AUDIO[v]) return;
    letterBuffers.set(k, 'pending');
    const bin = atob(LETTER_AUDIO[v][L]);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    audioCtx.decodeAudioData(u.buffer)
      .then(b => letterBuffers.set(k, b))
      .catch(() => letterBuffers.delete(k));
  }));
}

function playLetter(t) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  /* "Mixed" redraws the speaker every trial, so the letter has to be heard through a
     voice rather than remembered as a sound. It never changes the answer: identity is
     compared on the letter index. */
  const v = cfg.letterVoice === 'mix' ? pick(Object.keys(LETTER_VOICES)) : cfg.letterVoice;
  const buf = letterBuffers.get(v + '/' + LETTER_KEYS[t.letter]);
  if (!buf || buf === 'pending') return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const g = audioCtx.createGain();
  g.gain.value = 0.9;
  let tail = g;
  if (t.pan != null && audioCtx.createStereoPanner) {
    const pn = audioCtx.createStereoPanner();
    pn.pan.value = PANS[t.pan];
    g.connect(pn); tail = pn;
  }
  src.connect(g); tail.connect(audioCtx.destination);
  src.start();
}

function playTone(t) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const set = voiceSet().voices;
  const v = set[t.timbre != null ? t.timbre : 0] || set[0];

  const gain = audioCtx.createGain();
  const peak = 0.09 * (v.level || 1);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.30);

  let tail = gain;
  if (t.pan != null && audioCtx.createStereoPanner) {
    const p = audioCtx.createStereoPanner();
    p.pan.value = PANS[t.pan];
    gain.connect(p); tail = p;
  }
  tail.connect(audioCtx.destination);

  const osc = buildVoice(audioCtx, v, t.pitch != null ? PITCHES[t.pitch] : 330, gain, now);
  osc.stop(now + 0.32);
}

