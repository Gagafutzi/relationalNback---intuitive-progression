"use strict";

/* ============================================================
   3. STATE
   ============================================================ */

const cfg = {
  mode: 'progression',                 // 'progression' | 'free'
  n: 1,
  streams: { position: 'relational' },
  dim: 3,
  rotation: false,
  spinPath: 'solved',     // 'solved' = non-degenerate turntable + roll, 'free' = original tumble
  spin: 60,
  frame: 'cube',                       // 'cube' | 'screen' | 'both'
  interval: 5000,
  blockLength: 20,
  gizmo: 'full',
  cellVis: 'lattice',
  layout: 'dense',
  cubeScale: 1,
  dailyGoal: 20,
  buzzer: false,
  feedback: 'reveal',
  lureRate: 0.20,
  meta: false,        // second-order relational judgements
  gate: 0,            // fraction of compare-only (gate-closed) trials
  retro: 0,           // 0 = off, else how many lags the post-cue can name
  varPriority: true,  // cue one stream to prioritise per block
};

/* Free Play keeps its own settings so switching modes doesn't clobber either one. */
const freeCfg = {
  n: 2, streams: { position: 'relational' }, dim: 3, rotation: false,
  spin: 60, frame: 'cube', interval: 2500, blockLength: 20, feedback: 'reveal',
  lureRate: 0.20, meta: false, gate: 0, retro: 0,
  /* varPriority was missing here while cfg defaulted it on, so Free Play silently
     ran without the cue that progression uses. */
  varPriority: true, fixedGlyphMap: false,
};

const tune = {
  adapt: 'bayes',                    // 'bayes' | 'fixed'
  startInterval: 5000, targetInterval: 3000, intervalStep: 250, maxInterval: 6500,
  spinStart: 100, spinEnd: 20, spinStep: 10,
  nMax: 3, nAfterStimulus: 2, blockLength: 20,
};

let prog = { streamCount: 1, n: 1, spinLevel: 0, interval: 5000, lureRate: 0.20 };

/* Each relational-complexity tier keeps its own ladder and its own staircase, so
   quaternary is a parallel track rather than something gated behind ~20 hours of
   ternary. Enthusiasts can start at the ceiling; the ladder underneath still works. */
let rcTier = 3;
const tiers = {};
function tierState(rc) {
  return tiers[rc] || (tiers[rc] = {
    prog: { streamCount: 1, n: 1, spinLevel: 0, interval: 5000, lureRate: 0.20 },
    stair: null,
  });
}
function switchTier(rc) {
  const cur = tierState(rcTier);
  cur.prog = { ...prog }; cur.stair = stairLog ? stairLog.slice() : null;
  rcTier = rc;
  const nx = tierState(rc);
  prog = { ...nx.prog };
  stairLog = nx.stair ? nx.stair.slice() : null;
  if (!stairLog) stairInit(tune.startInterval);
}

const state = {
  running: false, timer: null,
  history: [],            // every trial shown
  chain: [],              // only trials the gate ADMITTED — this is what n-back counts
  judgments: [], presses: new Set(),
  trial: 0, scored: 0, tally: {},
  lureTally: null,        // {ok,total,empty} restricted to lure trials
  cued: true,             // false while a retro-cue trial is still hiding its cue
  cueTimer: null,
  stimAt: 0,              // when the response window opened, for reaction times
  presses_log: [],        // {trial, ch, rt, ok} for every press in the block
  priorityStream: null,   // stream cued for extra weight this block
  paused: false, interrupted: false,
  builtSize: 0,           // cube box the lattice was last laid out for, in px
  spinKey: '',            // identity of the running spin, so a rebuild need not restart it
  stimShown: false,       // is a stimulus on screen right now (vs cleared for a retro cue)
  tickAt: 0,              // when the stimulus last swapped, for the late-press grace
  lastSnap: null,         // the interval just closed, still open to a late press
  buzzTimer: null,
  glyphMap: null, cells: [],
  sessionStart: null, keyIndex: {},
};

/* Declared here, but only populated once the profile registry below has resolved
   which record to read — `let profiles` sits in the persistence section and a call
   before it would hit the temporal dead zone. */
let progress = null;

/* ============================================================
   4. DOM
   ============================================================ */

const $ = id => document.getElementById(id);
const gridCube = $('gridCube'), cubeWrapper = $('cubeWrapper'), gizmoEl = $('gizmo');
const deckEl = $('deck'), modalEl = $('modal'), modalBox = $('modalBox');

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

