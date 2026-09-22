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
/* A uniform draw that will not land on one particular index.
   Falls back to a plain draw where there is nothing else to pick, so a
   one-cell grid still produces a trial. */
function randExcept(len, forbid) {
  if (forbid == null || len <= 1) return randInt(len);
  let i, guard = 0;
  do { i = randInt(len); guard++; } while (i === forbid && guard < 40);
  return i;
}

function sampleIndex(streamKey, len, nbackIdx, lureIdxs, forbid) {
  /* Lure is checked BEFORE the target-match roll. A lure is by definition not an
     n-back match, so rolling for a match first would silently eat the lure on 28% of
     the trials that were chosen to carry one. */
  const lures = (lureIdxs || []).filter(i => i != null && i !== nbackIdx && i !== forbid);
  if (lures.length && lureTarget === streamKey) {
    lureTarget = null; usedLure = true;
    return pick(lures);
  }
  /* A match that would leave the cube where it stands is not shown. The caller
     only forbids anything above lag one, where a match is never a repeat by
     construction — so this costs the occasional match and never all of them. */
  if (nbackIdx != null && nbackIdx !== forbid && Math.random() < TARGET_RATE) {
    return nbackIdx;
  }
  let i, guard = 0;
  do { i = randInt(len); guard++; }
  while ((i === nbackIdx || i === forbid) && guard < 40 && len > 1);
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

/* Cells reachable from `from` by a single-axis move. Once a move could run on
   several axes at once the meta branch stopped needing this — the relation is an
   angle, and every angle has an answer now that oblique is one of them. What is
   left is the relational lure, which wants a clean cardinal step so that
   mis-counting your lag yields a confident wrong answer rather than noise. */
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
/*
 * The move that realises a drawn relation to the previous one.
 *
 * Returns a destination on every axis at once — `{ cellIdx, levels }` — because
 * with coordinate axes the axis is part of the choice. With none configured the
 * levels come back empty and this behaves exactly as it did.
 *
 * The coordinate axes are where the extra orthogonality lives. A step along one
 * of them against a spatial previous move is orthogonal by construction, and
 * against a previous move on the same axis it is the only way to state same or
 * opposite — so an axis is not decoration, it is another way to answer
 * "orthogonal" where there were two.
 *
 * They are also where most of the oblique relations live, for the same reason:
 * a wider space has more directions in it that are neither aligned with a given
 * move nor square to it, and those are now drawn rather than skipped.
 *
 * `from` is the reference trial rather than a cell index, because a move starts
 * from a position on every axis.
 */
function pickMetaMove(fromIdx, from, A, forbid) {
  const dims = dimCount();
  const f = state.cells[fromIdx];

  /*
   * Every move of one step or none on each axis, the standing-still one aside.
   *
   * Composite, which is the change: a move used to be one axis, so "orthogonal"
   * could only mean "a different axis" and there were two of those in three
   * dimensions. A vector of ±1s has 26 directions in three dimensions and 80 in
   * four, and orthogonality becomes a dot product with far more ways to satisfy
   * it — which is what makes the relation worth deriving rather than reading off
   * the one axis that moved.
   */
  /*
   * Steps per axis, up to the cap. Two by default — three positions on an axis
   * leave displacements of one and two — and three when the cap is raised,
   * which is why the pools grow a level with it.
   *
   * The cube keeps ±1: a lattice three cells wide has nowhere to put a longer
   * spatial step, and the cap is about the coordinate axes, where a pool can be
   * spread as far as the property allows.
   */
  const cap = magnitudeCap();
  const spatial = [-1, 0, 1];
  const along = [];
  for (let m = -cap; m <= cap; m++) along.push(m);

  const offsets = [];
  const walk = (v) => {
    if (v.length === dims) {
      if (v.some(c => c !== 0)) offsets.push(v.slice());
      return;
    }
    (v.length < 3 ? spatial : along).forEach(c => walk(v.concat(c)));
  };
  walk([]);

  /* A move has to land somewhere that exists — inside the lattice, and inside
     the pool on the axis that is heard. */
  const cellAt = {};
  state.cells.forEach((c, i) => { cellAt[c.x + ',' + c.y + ',' + c.z] = i; });

  const axes = coordAxes();
  const moves = [];
  offsets.forEach(o => {
    const key = (f.x + o[0]) + ',' + (f.y + o[1]) + ',' + (f.z + o[2]);
    const idx = cellAt[key];
    if (idx == null) return;

    /* Each coordinate has to land inside its own pool, as a cell has to land
       inside the lattice. */
    const levels = {};
    let ok = true;
    axes.forEach((k, i) => {
      const v = (from[k] ?? 0) + o[3 + i];
      if (v < 0 || v >= poolFor(k).length) ok = false;
      levels[k] = v;
    });
    if (!ok) return;

    /* Standing exactly where it already stands reads as nothing happening. */
    const still = idx === forbid && axes.every(k => levels[k] === (from[k] ?? 0));
    if (still) return;
    moves.push({ cellIdx: idx, levels: levels, vec: o });
  });

  if (!A || !moves.length) {
    return moves.length
      ? pick(moves)
      : { cellIdx: randExcept(state.cells.length, forbid), levels: {} };
  }

  /*
   * Bucketed by the relation each move would state — all four of them.
   *
   * Oblique used to be dropped here, on the grounds that no button says
   * "neither". That reasoning had it backwards: the answer to a relation no
   * button names is to press nothing, which every other stream in the app
   * already asks for. Dropping it restricted the draw to the three special
   * cases of a move that may now run on any number of axes, and those are by
   * far the rarer ones — most pairs of composite moves are oblique, so the
   * generator was throwing away most of the space it had just been given in
   * order to protect a deck that needed no protecting.
   */
  const byType = { same: [], opp: [], diff: [], obl: [] };
  moves.forEach(m => {
    const rel = metaRelationOf(A, m.vec);
    if (rel) byType[rel].push(m);
  });

  const avail = ['same', 'opp', 'diff', 'obl'].filter(k => byType[k].length);
  if (!avail.length) return pick(moves);
  return pick(byType[pickMetaType(avail)]);
}

/*
 * Which relation to aim for next, among the ones this position can state.
 *
 * Proportional to how far each type is BEHIND `META_SHARE`, rather than to a
 * fixed weight. The weights this replaces could not deliver a share, because a
 * weight is spent whether or not the type it names was on offer: `same` means
 * continuing straight and a wall blocks it two trials in three, so its mass
 * went to whatever was reachable instead — mostly `opp`, which is reachable
 * from everywhere, always, since the cube can always turn round and go back.
 *
 * A deficit cannot be spent while its type is blocked. It accumulates instead,
 * and the relation is taken the moment a wall stops being in the way, which is
 * the correction a scarce relation actually needs.
 *
 * `META_FLOOR` keeps a type that is already ahead of its share in the draw, so
 * this stays a sampler and not a schedule — nothing here is ever due, and a
 * block cannot be read off by counting what has not come up yet.
 *
 * The tally is the block's, cleared by `startBlock`, because the histogram the
 * score is corrected against is the block's too: `chanceOf` reads the answer
 * pattern this draw produces, so the two have to be counting the same trials.
 */
function pickMetaType(avail) {
  const seen = state.metaDrawn ||
    (state.metaDrawn = { same: 0, opp: 0, diff: 0, obl: 0 });
  const drawn = seen.same + seen.opp + seen.diff + seen.obl;
  /* `drawn + 1` counts the trial being drawn now, so the first of a block has a
     deficit to work with rather than four zeroes and a coin toss. */
  const w = avail.map(k =>
    Math.max(META_FLOOR, META_SHARE[k] * (drawn + 1) - seen[k]));
  let r = Math.random() * w.reduce((s, v) => s + v, 0);
  const type = avail[w.findIndex(v => (r -= v) < 0)] ?? avail[avail.length - 1];
  seen[type]++;
  return type;
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

  /* The cube always moves.
     Standing still reads as nothing having happened — the eye has no event to
     attach the judgement to, and above lag one it is never a target either, so
     the trial asks for a comparison against a picture that did not change.

     Lag one is the whole exception: there the previous trial *is* the n-back
     item, so a position match is a repeat by definition and forbidding one would
     make the match unstateable.

     Above that the rule is unconditional, including when the n-back cell happens
     to be where the cube already stands. That trial simply is not a match —
     matches are drawn at a rate rather than owed on particular trials, and the
     first attempt at this exempted the case, which let a stationary cube back in
     on about one trial in twenty-six. */
  const prev = backAt(1);
  const noRepeat = prev && n > 1 ? prev.cellIdx : null;
  /* Set by the meta branch when it picks the axis as well as the cell. */
  let metaMove = null;

  /* Identity mode needs forced matches (1/27 is far too rare otherwise);
     relational mode is dense by construction, so sample freely. */
  if (cfg.meta && rel('position') && nb) {
    /* Every delta cardinal, so both first-order directions are unambiguous — and the
       target is chosen by RELATION type, not by neighbour. Sampling neighbours
       uniformly yields same 5% / opposite 28% / different 66%, because four of six
       directions leave the axis and walls block continuing straight; "always answer
       different" would then score 66%. */
    metaMove = pickMetaMove(nb.cellIdx, nb,
                            nb.pair ? moveVectorOf(nb.pair[0], nb.pair[1]) : null,
                            noRepeat);
    t.cellIdx = metaMove.cellIdx;
  } else if (rel('position') && nb && lureTarget === 'position') {
    /* Relational lure: make the move from the (n−1)-back item clean and cardinal,
       so mis-counting your lag yields a confident WRONG answer rather than noise.
       Without this the lure axis would do nothing until identity streams appear. */
    const cand = lureA ? cardinalNeighbours(lureA.cellIdx)
                          .filter(i => i !== nb.cellIdx && i !== noRepeat) : [];
    if (cand.length) { t.cellIdx = pick(cand); usedLure = true; lureTarget = null; }
    else t.cellIdx = randExcept(state.cells.length, noRepeat);
  } else if (rel('position') || !on('position')) {
    t.cellIdx = randExcept(state.cells.length, noRepeat);
  } else {
    t.cellIdx = sampleIndex('position', state.cells.length, nb ? nb.cellIdx : null,
                            [lureA && lureA.cellIdx, lureB && lureB.cellIdx],
                            noRepeat);
  }

  const feature = (key, pool) => {
    if (!on(key)) return null;
    if (rel(key)) return randInt(pool.length);
    return sampleIndex(key, pool.length, nb ? nb[key] : null,
                       [lureA && lureA[key], lureB && lureB[key]]);
  };

  /* `poolFor` rather than the raw pools: a property that is a coordinate has a
     pool of its own, and drawing a stream against the wrong length is how an
     index lands outside what gets rendered. (A coordinate's stream is off, so
     these return null for it and the block below draws it instead.) */
  t.pitch    = feature('pitch',    poolFor('pitch'));
  t.timbre   = feature('timbre',   voiceSet().voices);
  t.pan      = feature('pan',      PANS);
  t.color    = feature('color',    poolFor('color'));
  t.size     = feature('size',     poolFor('size'));
  t.quantity = feature('quantity', poolFor('quantity'));
  t.letter   = feature('letter',   LETTER_KEYS);

  /*
   * The coordinates, once the features have had their say.
   *
   * Written last because they are not features: a coordinate is part of *where
   * the stimulus is*, and `feature(k, …)` would have drawn it as an independent
   * stream — the one thing it must not be, since nothing is judged twice.
   */
  coordAxes().forEach(k => {
    if (!rel('position')) return;
    const pool = poolFor(k);
    if (metaMove) {
      t[k] = metaMove.levels[k] ?? (nb ? nb[k] ?? 0 : 0);
    } else if (nb) {
      /*
       * A step on this axis alongside whatever the others did, rather than
       * instead of them. The move is a vector, so every component is drawn the
       * same way and nothing is held back to keep the move on one axis.
       */
      const cap = magnitudeCap();
      const from = nb[k] ?? 0;
      const steps = [0];
      for (let m = 1; m <= cap; m++) {
        if (from - m >= 0) steps.push(-m);
        if (from + m < pool.length) steps.push(m);
      }
      t[k] = from + pick(steps);
    } else if (t[k] == null) {
      t[k] = randInt(pool.length);
    }
  });

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

