"use strict";

/* ============================================================
   8b. TRIAL RENDERING
   ============================================================ */

/* The other half of a trial: the sampler that decides what a trial is lives
   in `model.js`, which this file needs a browser to be of any use to. */

/* ---------- Reading the slot off the slot ----------
 *
 * Where the stimulus is, printed on it.
 *
 * A cube lattice in perspective projects the middle slots close together, and
 * telling two of them apart is then a perception problem: you look, you work out
 * which layer it is in, and only then do you have the thing the trial was
 * actually asking you to remember. The rails (`cellVis: 'guides'`) answer this by
 * drawing three lines through the slot, which works and costs the whole lattice
 * in clutter. This answers it by writing the coordinates on the lit face instead
 * — the same information, no extra geometry, and it reads at a glance rather
 * than after a look.
 *
 * Three forms, because what is glanceable is personal:
 *   letters — the axis names the response buttons already use (W/E, N/S, B/A),
 *             which is the form that needs no translating at answer time;
 *   numbers — rank on each axis, 1 upwards, in the order W→E, N→S, B→A;
 *   pips    — one row per axis with the slot's own position filled in, which is
 *             a picture rather than a word and survives being read sideways.
 *
 * Written on every face, like the glyph, so whichever side of the cube is toward
 * you carries it — and the faces turned away are hidden in CSS while a readout is
 * on (see `.has-readout`), or the far side would show through an outlined cell
 * mirrored.
 */
const READOUT_AXES = [
  { neg: 'W', pos: 'E', key: 'x' },
  { neg: 'N', pos: 'S', key: 'y' },
  { neg: 'B', pos: 'A', key: 'z' },
];

/* Hair space between the groups: a normal space at this size reads as a gap
   between three separate labels rather than one coordinate. */
const READOUT_SEP = '\u2009';

function readoutHTML(cellIdx, cellW) {
  const mode = cfg.slotReadout;
  if (!mode || mode === 'off') return '';
  const c = state.cells[cellIdx];
  if (!c) return '';
  const dim = cfg.dim, off = (dim - 1) / 2;
  /* Sized off the cell it is printed on, divided by roughly how many characters
     wide the form is, and clamped: a 4-cube's slots are small enough to need the
     floor, and a scaled-up 3-cube big enough to need the ceiling. */
  const px = n => Math.max(5, Math.min(24, (cellW || 60) / n));

  if (mode === 'pips') {
    const rows = READOUT_AXES.map(ax => {
      let row = '';
      for (let i = 0; i < dim; i++) row += (i === c[ax.key] ? '\u25cf' : '\u25cb');
      return row;
    });
    return `<span class="rd pips" style="font-size:${px(dim * 1.25)}px">` +
           rows.join('<br>') + '</span>';
  }

  const parts = READOUT_AXES.map(ax => {
    if (mode === 'numbers') return String(c[ax.key] + 1);
    /* Signed distance from the centre of the lattice, which is what "where is it
       compared to the middle" means — and on an even-sided cube there is no
       centre slot, so the step count is rounded away from the half. */
    const d = c[ax.key] - off;
    if (!d) return '\u2013';
    const mag = Math.round(Math.abs(d));
    return (d < 0 ? ax.neg : ax.pos) + (mag > 1 ? mag : '');
  });
  return `<span class="rd" style="font-size:${px(mode === 'numbers' ? 6 : 7.5)}px">` +
         parts.join(READOUT_SEP) + '</span>';
}

/* Repaint the readout on the slot already lit, without replaying its sound.
   Changing the setting mid-block otherwise shows nothing until the next trial,
   which reads as a control that does not work. */
function refreshReadout() {
  const t = state.currentTrial;
  if (!state.stimShown || !t) return;
  const cell = state.cells[t.cellIdx];
  if (!cell) return;
  const cellW = parseFloat(cell.el.style.width) || 0;
  const html = readoutHTML(t.cellIdx, cellW);
  cell.el.querySelectorAll('.cell-face').forEach(f => {
    const old = f.querySelector('.rd');
    if (old) old.remove();
    if (html) f.insertAdjacentHTML('beforeend', html);
  });
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
  const sizePool = poolFor('size');
  const scale = Math.min(1, maxFont / sizePool[sizePool.length - 1]);
  const fontSize = (t.size != null ? sizePool[t.size] : 26) * scale;

  /* Quantity gets its own marker row rather than repeating the glyph — repeating a
     multi-character glyph like "III" three times is unreadable. */
  let html = '';
  if (glyphChar) html += `<span class="g" style="font-size:${fontSize}px">${glyphChar}</span>`;
  if (t.quantity != null) {
    const dots = '●'.repeat(poolFor('quantity')[t.quantity]);
    const qs = glyphChar ? Math.max(7, fontSize * 0.32) : Math.max(9, fontSize * 0.55);
    html += `<span class="q" style="font-size:${qs}px">${dots}</span>`;
  }
  if (!glyphChar && t.quantity == null && t.size != null)
    html = `<span class="g" style="font-size:${fontSize}px">●</span>`;

  /* The built cell width rather than the lattice pitch: in the spaced layout a
     cell is a fraction of its pitch, and sizing the readout off the pitch would
     print it straight over the edges. */
  const readout = readoutHTML(t.cellIdx, parseFloat(cell.el.style.width) || cellPx);

  faces.forEach(f => {
    if (t.color != null) litColour(f, poolFor('color')[t.color]);
    f.innerHTML = html + readout;
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
  const el = $('lagGhost');
  if (!cfg.varN || t.n == null) { el.classList.remove('show'); return; }
  el.textContent = t.n;
  el.classList.remove('show');
  void el.offsetWidth;                 // reflow, or the animation never replays
  el.classList.add('show');
}

const hideLagCue = () => $('lagGhost').classList.remove('show');

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

/*
 * Everything that says "that was wrong", in one call.
 *
 * The two error kinds stay distinguishable in every channel they use: a wrong
 * press and a miss are opposite mistakes needing opposite corrections, so the
 * pulse pattern splits the way the sounds already do.
 */
function signalWrong(kind) {
  playBuzz(kind);
  buzzPhone(kind);
}

function buzzPhone(kind) {
  if (!cfg.haptics || !navigator.vibrate) return;
  /* Wrapped because a browser that exposes vibrate behind a user-gesture rule
     throws rather than returning false, and a failed buzz must never take the
     block down with it. */
  try { navigator.vibrate(kind === 'miss' ? [40, 60, 40] : 90); } catch (e) { /* no vibrator */ }
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
  const peak = 0.09 * (v.level || 1) * pitchLevel(t.pitch);
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

  /* Clamped into the pool rather than indexed straight into it: the tone count is
     a live setting, and a trial sampled against a wider pool can still be on
     screen when it narrows. An index past the end would hand the oscillator an
     undefined frequency, which is silence with a console error behind it. */
  const pool = poolFor('pitch');
  const freq = t.pitch != null ? pool[Math.min(t.pitch, pool.length - 1)] : 330;
  const osc = buildVoice(audioCtx, v, freq, gain, now);
  osc.stop(now + 0.32);
}

