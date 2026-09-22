#!/usr/bin/env node
/*
 * The four meta-relations arrive at about the same rate.
 *
 * They did not. `pickMetaMove` used to weight the relation types it could
 * reach — `{ same: 3, opp: 3, diff: 1, obl: 1 }` — and a weight over what is
 * AVAILABLE cannot deliver a share. How often each relation is reachable at all
 * from where the cube stands, over a stationary walk on a 3-cube: opposite
 * 100%, oblique 100%, orthogonal 97%, and `same` — continuing straight — 33%,
 * because a wall is in the way on two trials in three. Same's weight was then
 * spread over whatever was left, and opposite, carrying the same weight, took
 * most of it: opposite answered 53% of trials, `same` 13%.
 *
 * `pickMetaType` draws against the block's running deficit instead, which a
 * blocked relation accumulates rather than forfeits. This checks the result on
 * the relation the player is actually ASKED — recomputed the way
 * `buildJudgments` does, from the pair, not read off the draw — so a generator
 * that aimed at a share it then failed to state would still fail here.
 *
 * `judgments.js` is loaded beside `trials.js` so the relation rule under test
 * is the app's own. The existing no-repeat check leaves `pair` unset, which
 * makes `A` null and returns before any of this runs.
 *
 *   node tools/meta-rate-check.js
 */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

let bad = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond ? '' : '  ' + extra));
  if (!cond) bad++;
};

function cells(dim) {
  const out = [];
  for (let x = 0; x < dim; x++) for (let y = 0; y < dim; y++) for (let z = 0; z < dim; z++) {
    out.push({ x, y, z });
  }
  return out;
}

const REL = ['same', 'opp', 'diff', 'obl'];

function run({ n = 2, dim = 3, coords = [], trials = 80000, blockLength = 20 }) {
  const ctx = vm.createContext({ console, Math, Array, Object, JSON, Set });
  vm.runInContext(`
    var cfg = { n: ${n}, meta: true, lureRate: 0, gating: false, varN: 0, retro: 0,
                magnitudeCap: 2, coordAxes: ${JSON.stringify(coords)},
                streams: { position: 'relational' } };
    var state = { cells: ${JSON.stringify(cells(dim))}, chain: [], metaDrawn: null };
    var STREAM_KEYS = ['position','pitch','timbre','pan','color','size','quantity','letter'];
    var PITCHES = [0,0,0], PANS = [0,0,0], COLORS = [0,0,0],
        SIZES = [0,0,0], COUNTS = [0,0,0], LETTER_KEYS = [0,0,0,0];
    function voiceSet() { return { voices: [0,0,0] }; }
    function coordAxes() { return cfg.coordAxes; }
    function magnitudeCap() { return 2; }
    function dimCount() { return 3 + cfg.coordAxes.length; }
    function poolFor(k) {
      return { pitch: PITCHES, pan: PANS, color: COLORS, size: SIZES,
               quantity: COUNTS, letter: LETTER_KEYS }[k] || [0,0,0];
    }
    /* Only the two the meta branch reaches; the pole ids are never rendered here. */
    var STREAMS = {};
    function coordPoles() { return [null, null]; }
    var TARGET_RATE = 0.28, EPS = 0.20;
    var META_SHARE = { same: 0.25, opp: 0.25, diff: 0.25, obl: 0.25 };
    var META_FLOOR = 0.05;
    function cardinalOf() { return null; }
    function positionGuides() {}
  `, ctx);

  for (const f of ['js/judgments.js', 'js/trials.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  }

  const counts = { same: 0, opp: 0, diff: 0, obl: 0 };
  let asked = 0;
  for (let i = 0; i < trials; i++) {
    /* Blocks, not one long chain. `startBlock` clears the chain and the deficit
       together, and the deficit repays itself over a run far longer than twenty
       trials — so a continuous chain measures a rate the player never sees. */
    if (i % blockLength === 0) {
      vm.runInContext('state.chain = []; state.metaDrawn = null;', ctx);
    }
    /*
     * Sample, then wire the pair up exactly as `block.js` does — the partner is
     * the n-back item and `metaPrev` is that item's own pair, so the relation
     * measured here is between the same two moves the deck asks about.
     */
    const rel = vm.runInContext(`(function () {
      var t = sampleTrial();
      var C = state.chain;
      var partner = C[C.length - t.n];
      t.pair = partner ? [partner, t] : null;
      C.push(t);
      var prev = t.pair && t.pair[0].pair;
      if (!prev) return null;
      return metaRelationOf(moveVectorOf(prev[0], prev[1]),
                            moveVectorOf(t.pair[0], t.pair[1]));
    })()`, ctx);
    if (rel) { counts[rel]++; asked++; }
  }
  return { counts, asked };
}

/*
 * What is asserted is the property, not the target.
 *
 * A quarter each is what `META_SHARE` aims at, but a 3-cube cannot deliver it
 * inside one block — see the note on `META_SHARE`. Pinning the check to
 * 0.25 would therefore encode the lattice's shortfall as a requirement, and a
 * 4-cube or a longer block would have to be exempted from its own improvement.
 *
 * The two things that actually have to hold are that no answer dominates and
 * none disappears. `CEILING` is what makes this a regression test: the draw
 * this replaced put opposite at 0.52 and fails it by a wide margin.
 */
const CEILING = 0.35, FLOOR = 0.12;

for (const [label, cfg] of [
  ['3-cube, n=2, no coordinate axes', { n: 2, dim: 3 }],
  ['3-cube, n=3, no coordinate axes', { n: 3, dim: 3 }],
  ['3-cube, n=2, one coordinate axis', { n: 2, dim: 3, coords: ['pitch'] }],
  ['4-cube, n=2, no coordinate axes', { n: 2, dim: 4 }],
]) {
  const r = run(cfg);
  const share = k => r.counts[k] / r.asked;
  const top = REL.reduce((a, k) => share(k) > share(a) ? k : a, REL[0]);
  const low = REL.reduce((a, k) => share(k) < share(a) ? k : a, REL[0]);
  console.log(`\n${label}  (${r.asked} scored trials)`);
  console.log('   ' + REL.map(k => `${k} ${(100 * share(k)).toFixed(1)}%`).join('   '));
  ok(`${label}: no answer dominates (\u2264 ${CEILING})`, share(top) <= CEILING,
     `${top} is ${(100 * share(top)).toFixed(1)}%`);
  ok(`${label}: no answer vanishes (\u2265 ${FLOOR})`, share(low) >= FLOOR,
     `${low} is ${(100 * share(low)).toFixed(1)}%`);
}

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');
process.exit(bad ? 1 : 0);
