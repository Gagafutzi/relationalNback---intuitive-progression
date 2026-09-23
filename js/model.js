"use strict";

/* ============================================================
   8. TRIAL GENERATION — the model
   ============================================================ */

/*
 * What a trial IS, with nothing about how it looks.
 *
 * This half of trial generation touches no DOM, plays no sound and knows
 * nothing about the cube on screen — it draws a lag, picks a cell, picks a
 * relation to the previous move, and returns an object. `trials.js` keeps the
 * other half, which turns that object into a lit slot and a tone.
 *
 * It is a file of its own so it can be read back. The checks in `tools/` used
 * to reach it by standing up a `vm` context and feeding it a page of stubs,
 * and `ladder-check` went further and sliced `pickMetaMove` out of the source
 * by string index — which is why adding `pickMetaType` beside it broke that
 * tool with a ReferenceError seven hundred lines from the cause. A tool can now
 * require this file and ask it questions.
 *
 * `createSampler` takes the world rather than reaching for it. Everything named
 * here is a global in the browser and a plain object in a test, and `cfg` and
 * `state` are mutated in place rather than reassigned, so holding the reference
 * is holding the live thing. `boot.js` wires it up once everything is loaded.
 *
 * `moveVectorOf` and `metaRelationOf` came over from `judgments.js`. They say
 * what a move IS and how two of them stand to each other, which the sampler has
 * to know to draw a relation at all; scoring a press against them is the part
 * that stayed behind.
 */

function createSampler(env) {
  const {
    cfg, state,
    STREAM_KEYS, TARGET_RATE, META_SHARE, META_FLOOR, PANS, LETTER_KEYS,
    GLYPH_SET_KEYS, dimCount, magnitudeCap, coordAxes, poolFor, voiceSet,
  } = env;
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
  /**
   * The move as a vector — every axis it happened on, not the one it happened on.
   *
   * A move on several axes at once was previously nameless: `cardinalOf` returns
   * null unless exactly one component is non-zero, and the meta relation was
   * built on that, so "orthogonal" could only ever mean "a different axis". With
   * a vector it means what it says — a zero dot product — and there are far more
   * ways to satisfy it, which is the whole reason to allow composite moves.
   */
  function moveVectorOf(a, b) {
    const ca = state.cells[a.cellIdx], cb = state.cells[b.cellIdx];
    const d = [cb.x - ca.x, cb.y - ca.y, cb.z - ca.z];
    /* One component per coordinate axis, in the order they were chosen — the same
       order `CARDINAL_IDS` names them in, or a move would be reported as a step on
       somebody else's property. */
    coordAxes().forEach(k => d.push((b[k] ?? 0) - (a[k] ?? 0)));
    return d;
  }

  const dot = (A, B) => A.reduce((s, v, i) => s + v * (B[i] || 0), 0);
  const norm = A => Math.sqrt(dot(A, A));

  /**
   * How one move stands to another: parallel, antiparallel, orthogonal, or
   * oblique — none of the three.
   *
   * Oblique is a relation, not a gap. Single-axis moves never produced one — two
   * axis-aligned vectors are always parallel, antiparallel or perpendicular — so
   * for as long as a move was one axis the three answers were exhaustive.
   * Composite moves break that: (1,0,0) and (1,1,0) sit at 45°, which is a
   * perfectly definite thing for two moves to do and was being thrown away.
   *
   * It is returned as `'obl'` rather than suppressed, and answered by pressing
   * nothing. That is the point of it: the selection pressure on this mode was
   * always "only draw what a button can say", which quietly restricted the space
   * to the special cases. A relation with no button widens the space at no
   * response cost — and it is the one answer the deck cannot prompt you toward,
   * so it has to be derived rather than recognised.
   *
   * `null` now means only that there is no relation to state at all: a missing
   * move, or one that went nowhere.
   */
  function metaRelationOf(A, B) {
    if (!A || !B) return null;
    const na = norm(A), nb = norm(B);
    if (!na || !nb) return null;

    const d = dot(A, B);
    if (d === 0) return 'diff';

    /* Cosine rather than a component test, because either vector may be composite. */
    const cos = d / (na * nb);
    if (cos > 1 - 1e-9) return 'same';
    if (cos < -1 + 1e-9) return 'opp';
    return 'obl';
  }

  return {
    randInt, pick, randExcept, sampleIndex, backAt, maxLag, trialLag,
    cardinalNeighbours, pickMetaMove, pickMetaType, sampleTrial,
    moveVectorOf, metaRelationOf,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = createSampler;
