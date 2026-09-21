"use strict";

/* ============================================================
   3. STATE
   ============================================================ */

/*
 * A property is a coordinate or a stream, never both.
 *
 * A step on a coordinate *is* the move, so judging that property separately
 * would ask the same question twice and score it twice — and the second answer
 * would be the first one wearing a different button.
 *
 * Enforced rather than documented: the settings screen can offer both, and a
 * saved configuration from before this existed can hold both.
 */
function applyDimensions(c) {
  c = c || cfg;
  coordAxes(c).forEach(k => { if (c.streams) delete c.streams[k]; });
  return c;
}

const cfg = {
  mode: 'progression',                 // 'progression' | 'free'
  n: 1,
  streams: { position: 'relational' },
  dim: 3,
  /*
   * The reason coordinate axes exist at all is orthogonality. There are as many
   * mutually orthogonal directions as there are dimensions, so a fourth axis
   * gives a third way to be orthogonal instead of a second — the response set
   * stays at three while the space behind it grows, which is the only kind of
   * difficulty that costs no buttons. Quaternary at four back is eight
   * variables held and composed; widening the space makes the relation carry
   * more without asking memory to hold more.
   *
   * A property cannot be judged as a stream while it is a coordinate — nothing
   * is judged twice — and `applyDimensions` enforces that.
   */
  /*
   * Properties that are coordinates of the move rather than streams beside it.
   * Empty is the cube alone; each entry adds an axis, so `dimCount` is three
   * plus however many are listed. Order matters and is the order they are
   * judged and named in.
   */
  coordAxes: [],
  /*
   * The furthest a move may travel on a coordinate axis: two, or three.
   *
   * Two means three levels on the axis, three means four — the pools grow with
   * it so that the levels stay as far apart as the property allows. A cap is
   * not a limit on difficulty so much as on ambiguity: three levels maximally
   * spread are easier to place than five crowded ones, and a displacement of
   * two on a three-level axis is unmistakable.
   */
  magnitudeCap: 2,
  /*
   * Deeper tones louder, as a second cue on the same axis.
   *
   * Only useful where pitch is a coordinate, but harmless as a stream too, so
   * it is not gated on the dimension count — a player who finds the tones hard
   * to place can have the help either way.
   */
  pitchLoudness: false,
  /*
   * How many notes the Tone stream draws from, across a fixed three octaves.
   *
   * Four to start — octaves, as far apart as notes in one span can be — and up
   * to twelve, a minor third a step. In Progression it is not set by hand at
   * all: `toneRatchet` widens the pool off the tone stream's own accuracy, the
   * way the lure rate widens off lure trials. See the tone pool in constants.js.
   */
  toneCount: TONE_DEFAULT,
  rotation: false,
  spinPath: 'solved',     // 'solved' = non-degenerate turntable + roll, 'free' = original tumble
  voiceSet: 'waves',      // which four timbres the timbre stream draws from
  letterVoice: 'slt',     // who reads the letters, or 'mix' for a new speaker each trial
  spin: 60,
  frame: 'cube',                       // 'cube' | 'screen' | 'both'
  interval: 5000,
  blockLength: 20,
  gizmo: 'full',
  cellVis: 'lattice',
  /*
   * 'solid' fills the lit slot; 'outline' draws nothing but its edges, and
   * strips the lattice's faint fills with it.
   *
   * A fill is six coloured surfaces per cell, and in a lattice seen in
   * perspective those surfaces are most of what is on screen. The outline says
   * the same thing with twelve lines, so the one lit slot is the only solid
   * thing in the picture. The colour stream still reads: the edge takes the hue
   * the face would have had.
   */
  cellFill: 'solid',
  /*
   * Print the lit slot's own coordinates on it, so the position is READ rather
   * than deduced from where the cell sits in a projection. 'off', 'letters'
   * (the axis names the buttons use), 'numbers' (rank on each axis) or 'pips'.
   *
   * Recorded with the block, because it is an assist: the middle slots of a
   * dense cube project close enough together that telling them apart is a
   * perception task rather than a memory one, and this removes that task
   * instead of making it easier.
   */
  slotReadout: 'off',
  layout: 'dense',
  cubeScale: 1,
  dailyGoal: 20,
  buzzer: false,
  /* A pulse for a wrong answer on a phone. On by default: unlike the buzzer it
     costs nothing to have on, works with the sound off, and on the desktop where
     there is no vibrator it simply never fires. */
  haptics: true,
  /* Meta-relations chains: this trial's answer depends on the move you made last
     trial, so one wrong answer costs you the anchor and every trial after it is a
     guess. On an error the two moves are spelled out so you can rejoin. */
  moveTrace: true,
  /* Seconds to wait on the report before the next block starts itself, or 0 for the
     old behaviour of waiting to be told. */
  autoAdvance: 0,
  feedback: 'reveal',
  lureRate: 0.20,
  meta: false,        // second-order relational judgements
  gate: 0,            // fraction of compare-only (gate-closed) trials
  retro: 0,           // 0 = off, else how many lags the post-cue can name
  varN: 0,            // 0 = fixed N, else the ± spread the per-trial lag is drawn in
  varPriority: true,  // cue one stream to prioritise per block
  fixedGlyphMap: false,   // live rule; Progression forces it off, see applyProgression
};

/* What Progression owns that the ladder does not decide for it. Symmetric with
   freeCfg below, and it exists because the asymmetry was a bug: Progression had no
   copy of its own, so its Feedback control wrote straight to cfg — which the first
   visit to Free Play then overwrote, silently and permanently. It was never saved
   either, so it reset on every reload. */
const progCfg = {
  feedback: 'reveal',
  /* Progression's own copy, for the same reason it keeps its own feedback: these
     were reaching a ladder run out of Free Play's settings, so a box ticked in one
     mode silently changed what the other mode's recorded ability was about. */
  coordAxes: [], magnitudeCap: 2, pitchLoudness: false,
};

/* Free Play keeps its own settings so switching modes doesn't clobber either one. */
const freeCfg = {
  n: 2, streams: { position: 'relational' }, dim: 3,
  coordAxes: [], magnitudeCap: 2, pitchLoudness: false, rotation: false,
  /* Free Play's is a setting like every other one here; Progression's lives on
     the ladder, where it is earned rather than chosen. */
  toneCount: TONE_DEFAULT,
  spin: 60, frame: 'cube', interval: 2500, blockLength: 20, feedback: 'reveal',
  lureRate: 0.20, meta: false, gate: 0, retro: 0, varN: 0,
  /* varPriority was missing here while cfg defaulted it on, so Free Play silently
     ran without the cue that progression uses. */
  varPriority: true, fixedGlyphMap: false,
};

const TUNE_DEFAULTS = {
  adapt: 'bayes',                    // 'bayes' | 'fixed'
  startInterval: 5000, targetInterval: 3000, intervalStep: 250, maxInterval: 6500,
  spinStart: 100, spinEnd: 20, spinStep: 10,
  nMax: 3, nAfterStimulus: 2, blockLength: 20,
  /* Chance-corrected: 0 is a player who never presses, 1 is perfect. See
     `targetAccuracy` in ladder.js for why one number means the same thing at
     every milestone, and why it belongs per tier. */
  targetAccuracy: 0.40,
};

/* The tunables for the tier you are on. Always mutated in place, never reassigned —
   the input handlers and every ladder function close over this object. Switching
   tiers copies values through it rather than swapping the reference. */
const tune = { ...TUNE_DEFAULTS };

/* `axisCount` and `capLevel` are the two digits above stream count, and only turn
   at quaternary and up — see PROG_AXES. Both default to 0, which is exactly the
   ladder as it was, so a record written before they existed restores onto a rung
   that still means what it meant. */
let prog = { streamCount: 1, n: 1, spinLevel: 0, interval: 5000, lureRate: 0.20,
             axisCount: 0, capLevel: 0, tones: TONE_DEFAULT };

/* Each relational-complexity tier keeps its own ladder, its own staircase and its
   own tunables, so quaternary is a parallel track rather than something gated behind
   ~20 hours of ternary. Enthusiasts can start at the ceiling; the ladder underneath
   still works. The tunables belong here for the same reason the ladder does: a target
   speed that is right for ternary is not the same target under a heavier relational
   load, and editing one used to silently edit the other. */
let rcTier = 3;
const tiers = {};
function tierState(rc) {
  return tiers[rc] || (tiers[rc] = {
    prog: { streamCount: 1, n: 1, spinLevel: 0, interval: 5000, lureRate: 0.20,
            axisCount: 0, capLevel: 0, tones: TONE_DEFAULT },
    stair: null,
    /* A tier first visited mid-session inherits the settings you are already using,
       so the first switch carries your speeds across instead of dropping you on the
       factory defaults. They diverge from there. */
    tune: { ...tune },
  });
}
function switchTier(rc) {
  const cur = tierState(rcTier);
  cur.prog = { ...prog }; cur.stair = stairLog ? stairLog.slice() : null;
  cur.tune = { ...tune };
  rcTier = rc;
  /* Read before the assign below: a tier being created right now copies `tune` as it
     still stands, which is what makes the inheritance above work. */
  const nx = tierState(rc);
  /* Defaults for a tier stored before these digits existed, applied on the way OUT
     of the store rather than on the way in, so a record is never rewritten by the
     act of looking at it. */
  prog = { axisCount: 0, capLevel: 0, tones: TONE_DEFAULT, ...nx.prog };
  Object.assign(tune, nx.tune);
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
  /* Set while `endBlock` is scoring, so the `stopBlock` it calls to tear the
     block down does not also record it as abandoned. */
  ending: false,
  builtSize: 0,           // cube box the lattice was last laid out for, in px
  spinKey: '',            // identity of the running spin, so a rebuild need not restart it
  stimShown: false,       // is a stimulus on screen right now (vs cleared for a retro cue)
  tickAt: 0,              // when the stimulus last swapped, for the late-press grace
  lastSnap: null,         // the interval just closed, still open to a late press
  buzzTimer: null,
  glyphMap: null, cells: [],
  /* `sessionStart` opens the segment running now; `activeMs` is every segment
     already closed by a pause. A block's time is the sum, never the wall clock
     between its start and its end — see `stopBlock`. */
  sessionStart: null, activeMs: 0, keyIndex: {}, traceUntil: null, moveArrowAxis: null,
  autoTimer: null, autoAt: 0,
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

