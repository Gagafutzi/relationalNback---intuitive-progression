"use strict";

/* ============================================================
   1. CONSTANTS
   ============================================================ */

/* Six cube axes. `vec` is in CSS 3D space: +X right, +Y DOWN, +Z toward viewer. */
const AXES = [
  { id:'north', letter:'N', name:'North', vec:[ 0,-1, 0], color:'#4dabf7', key:'w' },
  { id:'south', letter:'S', name:'South', vec:[ 0, 1, 0], color:'#ff6b6b', key:'s' },
  { id:'east',  letter:'E', name:'East',  vec:[ 1, 0, 0], color:'#51cf66', key:'d' },
  { id:'west',  letter:'W', name:'West',  vec:[-1, 0, 0], color:'#fcc419', key:'a' },
  { id:'above', letter:'A', name:'Above', vec:[ 0, 0, 1], color:'#cc5de8', key:'e' },
  { id:'below', letter:'B', name:'Below', vec:[ 0, 0,-1], color:'#ff922b', key:'q' },
];
const AXIS = Object.fromEntries(AXES.map(a => [a.id, a]));

/* Transform that maps the element's local +X onto each axis direction. */
const AXIS_ORIENT = {
  east:  '',
  west:  'rotateY(180deg)',
  south: 'rotateZ(90deg)',
  north: 'rotateZ(-90deg)',
  above: 'rotateY(-90deg)',
  below: 'rotateY(90deg)',
};

/* Stimulus pools. Every pool is ORDERED so a relational judgement is well defined. */
const PITCHES = [220, 293.66, 392, 523.25];                 // A3 D4 G4 C5, low → high
const TIMBRES = ['sine', 'triangle', 'square', 'sawtooth']; // dull → bright
const PANS    = [-0.9, -0.3, 0.3, 0.9];                     // left → right
const COLORS  = ['#ff4d4d','#ff9f1a','#ffe14d','#4ddb6f','#4d9fff']; // warm → cool
const SIZES   = [15, 22, 30, 40];                           // small → large
const COUNTS  = [1, 2, 3, 4];                               // few → many

const GLYPH_SETS = {
  '123': ['1','2','3','4','5'],
  'ABC': ['A','B','C','D','E'],
  'αβγ': ['α','β','γ','δ','ε'],
  'IV' : ['I','II','III','IV','V'],
};
const GLYPH_SET_KEYS = Object.keys(GLYPH_SETS);

/* Stamped into every block and into the export. Testers who pick the file up at
   different times will be on different snapshots, and without this you cannot tell
   which build produced which numbers. */
const BUILD = '2026-08-23.7';

/* ---- Relational complexity (Halford) ----
   Difficulty defined by how many variables are bound in one representation.
   Quaternary is the documented adult ceiling, which is why meta-relations is brutal
   and why the ladder has a principled place to stop. A far better headline axis than
   N, which correlates only r≈.20 with complex span. */
const RC_NAMES = { 2: 'binary', 3: 'ternary', 4: 'quaternary', 5: 'quinary' };

function relationalComplexity(c) {
  c = c || cfg;
  let rc = 0;
  const pos = c.streams.position;
  if (pos === 'relational') rc = c.meta ? 4 : 3;
  else if (pos === 'identity') rc = 2;
  Object.keys(c.streams).forEach(k => {
    if (k === 'position') return;
    const m = c.streams[k];
    if (m === 'relational') rc = Math.max(rc, 3);
    else if (m === 'identity') rc = Math.max(rc, 2);
  });
  /* Two relations held at once across different spaces pushes past quaternary. */
  if (c.meta && c.frame === 'both') rc = 5;
  return rc || 2;
}

const TARGET_RATE = 0.28;  // forced identity matches
const EPS         = 0.20;  // "no movement on this axis" threshold, unit-normalised
const LURE_MIN = 0.10, LURE_MAX = 0.50;   // beyond ~0.5 the lure becomes the norm
const LURE_MIN_TRIALS = 4;                // don't adapt the rate on 1–2 noisy trials
const RETRO_MIN_RESPONSE = 700;           // ms left to answer after the cue appears
const RETRO_MIN_INTERVAL = 1300;          // below this a retro trial can't be answered

/* ---------- Stream registry ----------
   Each stream declares its channels (= response buttons) for each mode. */
const STREAMS = {
  position: {
    label: 'Position', color: '#8ab4ff',
    identity:   [{ id:'pos', glyph:'●', label:'Same', key:' ' }],
    relational: AXES.map(a => ({ id:a.id, glyph:a.letter, label:a.name, key:a.key, color:a.color })),
    /* Second-order judgement: how this move relates to the PREVIOUS move, rather
       than where it went. Three channels, not six — you only need to hold the
       direction you derived n trials ago, so response load stays low while the
       memory load is what actually rises. */
    meta: [
      { id:'meta-same', glyph:'⇉', label:'Same direction',  key:'w', color:'#51cf66' },
      { id:'meta-opp',  glyph:'⇄', label:'Opposite',        key:'s', color:'#ff6b6b' },
      { id:'meta-diff', glyph:'⤢', label:'Different axis',  key:'d', color:'#fcc419' },
    ],
    /* Screen-frame twins. Separate channels so "both frames" can ask for the same
       movement twice, once per reference frame. */
    relationalScreen: [
      { id:'s-north', glyph:'↑', label:'Screen up',    key:'i', color:'#4dabf7' },
      { id:'s-south', glyph:'↓', label:'Screen down',  key:'k', color:'#ff6b6b' },
      { id:'s-east',  glyph:'→', label:'Screen right', key:'l', color:'#51cf66' },
      { id:'s-west',  glyph:'←', label:'Screen left',  key:'j', color:'#fcc419' },
      { id:'s-near',  glyph:'⊕', label:'Toward you',   key:'o', color:'#cc5de8' },
      { id:'s-far',   glyph:'⊖', label:'Away from you',key:'u', color:'#ff922b' },
    ],
  },
  pitch: {
    label: 'Tone', color: '#7ee0d0',
    identity:   [{ id:'pitch', glyph:'♪', label:'Same', key:'j' }],
    relational: [{ id:'pitch-up', glyph:'♪↑', label:'Higher', key:'u' },
                 { id:'pitch-down', glyph:'♪↓', label:'Lower', key:'j' }],
  },
  color: {
    label: 'Colour', color: '#ffb74d',
    identity:   [{ id:'color', glyph:'■', label:'Same', key:'k' }],
    relational: [{ id:'color-warm', glyph:'■↑', label:'Warmer', key:'i' },
                 { id:'color-cool', glyph:'■↓', label:'Cooler', key:'k' }],
  },
  glyph: {
    label: 'Glyph', color: '#aed581',
    identity:   [{ id:'glyph', glyph:'✦', label:'Same', key:'l' }],
    relational: [{ id:'glyph-west',  glyph:'←', label:'Set left',  key:'arrowleft' },
                 { id:'glyph-east',  glyph:'→', label:'Set right', key:'arrowright' },
                 { id:'glyph-north', glyph:'↑', label:'Set up',    key:'arrowup' },
                 { id:'glyph-south', glyph:'↓', label:'Set down',  key:'arrowdown' },
                 { id:'glyph-up',    glyph:'+', label:'Rank up',   key:'o' },
                 { id:'glyph-down',  glyph:'−', label:'Rank down', key:'p' }],
  },
  pan: {
    label: 'Stereo', color: '#4dd0e1',
    identity:   [{ id:'pan', glyph:'◉', label:'Same', key:'n' }],
    relational: [{ id:'pan-left', glyph:'◀', label:'Left', key:'b' },
                 { id:'pan-right', glyph:'▶', label:'Right', key:'n' }],
  },
  timbre: {
    label: 'Timbre', color: '#b39ddb',
    identity:   [{ id:'timbre', glyph:'◍', label:'Same', key:'h' }],
    relational: [{ id:'timbre-up', glyph:'◍↑', label:'Brighter', key:'y' },
                 { id:'timbre-down', glyph:'◍↓', label:'Duller', key:'h' }],
  },
  size: {
    label: 'Size', color: '#f06292',
    identity:   [{ id:'size', glyph:'⬍', label:'Same', key:';' }],
    relational: [{ id:'size-up', glyph:'⬆', label:'Bigger', key:'.' },
                 { id:'size-down', glyph:'⬇', label:'Smaller', key:',' }],
  },
  quantity: {
    label: 'Quantity', color: '#ff8a65',
    identity:   [{ id:'qty', glyph:'#', label:'Same', key:'m' }],
    relational: [{ id:'qty-up', glyph:'#↑', label:'More', key:'m' },
                 { id:'qty-down', glyph:'#↓', label:'Fewer', key:'v' }],
  },
};
const STREAM_KEYS = Object.keys(STREAMS);

/* Extra scoring buckets that aren't user-configurable streams. */
const EXTRA_LABELS = { position2: 'Position (screen)' };
const labelFor = k => (STREAMS[k] ? STREAMS[k].label : EXTRA_LABELS[k]) || k;
const colorFor = k => (STREAMS[k] ? STREAMS[k].color : '#9ccc65');

/* Keys are assigned dynamically from this pool when a preferred key collides —
   enabling many streams at once (or "both frames") otherwise double-books keys. */
const KEY_POOL = ('qwertyuiopasdfghjkl;zxcvbnm,./1234567890').split('');

/* Every response channel in the app, tagged with the stream + mode slot it lives in.
   This is the list the keybind editor walks. */
const CHANNELS = STREAM_KEYS.flatMap(k =>
  ['identity', 'relational', 'relationalScreen'].flatMap(mode =>
    (STREAMS[k][mode] || []).map(c => ({ ...c, stream: k, mode }))));
const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map(c => [c.id, c]));

/* Two channels only clash if they can be on screen simultaneously. A stream is in
   exactly one mode at a time, so `pitch` (identity) and `pitch-down` (relational)
   sharing J is deliberate, not a conflict. The one exception is position, whose cube
   and screen channels are both live in "both frames" mode. */
function canCoOccur(a, b) {
  if (!a || !b) return false;
  if (a.stream !== b.stream) return true;
  if (a.mode === b.mode) return true;
  return a.stream === 'position' &&
         [a.mode, b.mode].sort().join('|') === 'relational|relationalScreen';
}

let keyBinds = {};                                   // channelId -> key (persisted)
const effectiveKey = id => keyBinds[id] || (CHANNEL_BY_ID[id] || {}).key;

/* Rebinding swaps with whatever held the key, but only among channels that could
   actually be active together — otherwise a harmless shared default gets clobbered. */
function rebind(id, key) {
  const me = CHANNEL_BY_ID[id], old = effectiveKey(id);
  CHANNELS.forEach(c => {
    if (c.id !== id && effectiveKey(c.id) === key && canCoOccur(me, c)) keyBinds[c.id] = old;
  });
  keyBinds[id] = key;
  buildDeck(); renderKeybinds(); saveProgress();
}

function clearBind(id) {
  delete keyBinds[id];
  buildDeck(); renderKeybinds(); saveProgress();
}

