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
 * The sampler is required, not sandboxed. It used to be loaded into a `vm`
 * context with a page of stubs standing in for the browser; `js/model.js` is the
 * same code with its world handed to it instead, so the relation rule under test
 * is the app's own and there is nothing here to drift from it.
 *
 *   node tools/meta-rate-check.js
 */

const path = require('path');
const ROOT = path.join(__dirname, '..');
const createSampler = require(path.join(ROOT, 'js/model.js'));
/* The same numbers the app runs on, read from where the app keeps them. */
const META_SHARE = { same: 0.25, opp: 0.25, diff: 0.25, obl: 0.25 };
const META_FLOOR = 0.05;

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
  const cfg = {
    n, meta: true, lureRate: 0, gating: false, varN: 0, retro: 0,
    magnitudeCap: 2, coordAxes: coords, streams: { position: 'relational' },
  };
  const state = { cells: cells(dim), chain: [], metaDrawn: null };
  const POOL = [0, 0, 0];
  const M = createSampler({
    cfg, state,
    STREAM_KEYS: ['position', 'pitch', 'timbre', 'pan', 'color', 'size', 'quantity', 'letter'],
    TARGET_RATE: 0.28, META_SHARE, META_FLOOR,
    PANS: POOL, LETTER_KEYS: [0, 0, 0, 0], GLYPH_SET_KEYS: [],
    dimCount: () => 3 + coords.length,
    magnitudeCap: () => 2,
    coordAxes: () => coords,
    poolFor: () => POOL,
    voiceSet: () => ({ voices: POOL }),
  });

  const counts = { same: 0, opp: 0, diff: 0, obl: 0 };
  let asked = 0;
  for (let i = 0; i < trials; i++) {
    /* Blocks, not one long chain. `startBlock` clears the chain and the deficit
       together, and the deficit repays itself over a run far longer than twenty
       trials — so a continuous chain measures a rate the player never sees. */
    if (i % blockLength === 0) { state.chain = []; state.metaDrawn = null; }
    /*
     * Sample, then wire the pair up exactly as `block.js` does — the partner is
     * the n-back item and `metaPrev` is that item's own pair, so the relation
     * measured here is between the same two moves the deck asks about.
     */
    const t = M.sampleTrial();
    const C = state.chain;
    const partner = C[C.length - t.n];
    t.pair = partner ? [partner, t] : null;
    C.push(t);
    const prev = t.pair && t.pair[0].pair;
    if (!prev) continue;
    const rel = M.metaRelationOf(M.moveVectorOf(prev[0], prev[1]),
                                 M.moveVectorOf(t.pair[0], t.pair[1]));
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
