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

/* ---------- Coordinates beyond the cube ----------
 *
 * A property can be a *coordinate of the move* rather than a stream beside it:
 * a step on it is part of where the stimulus went, judged exactly as the three
 * cube axes are.
 *
 * The reason to want more of them is orthogonality. There are as many mutually
 * orthogonal directions as there are dimensions, so each axis added gives
 * another way for two moves to be at right angles — the answers stay at three
 * while the space behind them grows, which is the only kind of difficulty that
 * costs no buttons. It is also the way to make a heavy relation carry more
 * without asking memory to hold more, which is what quaternary at four back
 * needs.
 *
 * A fourth *cell* coordinate would be four times the lattice with nothing to
 * draw it on. These are all properties the stimulus already has.
 *
 * **Poles come from the stream's own relational channels** — `pitch-up` and
 * `pitch-down`, `color-warm` and `color-cool` — so a coordinate needs no new
 * buttons, no new keys, and reads in the words the property already used.
 *
 * **Levels are their own pools, not the stream's.** A stream wants several
 * distinguishable values; a coordinate wants few, maximally far apart, in equal
 * steps — a step has to read as one step wherever on the axis it happens, and
 * an uneven pool makes the same displacement feel different depending where it
 * started. Two pools each, one per magnitude cap.
 */
const COORD_POOLS = {
  /* Octaves. Equal ratios, and the widest interval that stays one note. */
  pitch: { 2: [220, 440, 880], 3: [220, 440, 880, 1760] },
  /*
   * A hue sweep, which the colour stream already treats as ordered warm → cool.
   * Hue is a circle, so the pool stops short of wrapping: red to blue, never
   * round to red again, or a step would sometimes reverse its own direction.
   */
  color: {
    2: ['#ff4d4d', '#ffe14d', '#4d9fff'],
    3: ['#ff4d4d', '#ffe14d', '#4ddb6f', '#4d9fff'],
  },
  /* Equal ratios, because size discrimination is a ratio and not a difference. */
  size: { 2: [14, 24, 41], 3: [14, 20, 29, 41] },
  /*
   * Equal differences, because small counts are read exactly rather than
   * estimated — the one property here where a difference is the honest step.
   */
  quantity: { 2: [1, 3, 5], 3: [1, 2, 3, 4] },
};
const COORD_KEYS = Object.keys(COORD_POOLS);

/** The furthest a move may travel on one axis. Two unless asked otherwise. */
const magnitudeCap = c => ((c || cfg).magnitudeCap === 3 ? 3 : 2);

/** Which properties are coordinates of the move, in order. */
function coordAxes(c) {
  const list = (c || cfg).coordAxes;
  return Array.isArray(list) ? list.filter(k => COORD_POOLS[k]) : [];
}

/** The levels an axis uses — its own pool when it is a coordinate. */
function poolFor(k, c) {
  c = c || cfg;
  if (coordAxes(c).indexOf(k) >= 0) return COORD_POOLS[k][magnitudeCap(c)];
  /* The tone pool is the one that is sized by a setting rather than written
     down, so it is built here rather than named. Every other stream pool is a
     constant. */
  if (k === 'pitch') return tonePool(toneCount(c));
  return { color: COLORS, size: SIZES, quantity: COUNTS }[k];
}

/** The two channel ids this axis answers with: [positive, negative]. */
function coordPoles(k) {
  const rel = (STREAMS[k] || {}).relational || [];
  return [rel[0] && rel[0].id, rel[1] && rel[1].id];
}

/** Three cube axes plus one per coordinate, which is how many a move has. */
const dimCount = c => 3 + coordAxes(c).length;

/*
 * The response channels a coordinate axis is answered on: the property's own
 * two relational channels, borrowed whole — glyph, label and default key.
 *
 * The position deck has to carry these, because the axis is judged as part of
 * the position judgement and the property's own stream is off (it cannot be
 * judged twice). Without them a coordinate move is asked and cannot be
 * answered, which reads as a run of misses on a stream the player never saw.
 */
function coordChannels(c) {
  return coordAxes(c).flatMap(k => ((STREAMS[k] || {}).relational || []));
}

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

/* ---------- The tone pool ----------
 *
 * The same three octaves however many notes are in it, cut into equal steps.
 *
 * As a *stream* the tones are a pool of stimuli, and how many of them there are
 * is the whole of the difficulty: four notes an octave apart are told apart
 * without listening, twelve a minor third apart have to be placed. So the count
 * is a setting rather than a constant — and in Progression it is not even that,
 * it is earned (see `toneRatchet`).
 *
 * The SPAN is what is held fixed, not the step. Widening the range instead of
 * dividing it more finely would eventually ask for tones nobody's speakers
 * reproduce and nobody's ears place, and the point of the axis is discrimination
 * inside a range you can hear, not range.
 *
 * Steps are equal in RATIO, because pitch discrimination is one. Exactly equal,
 * not rounded to the nearest semitone: a step has to read as one step wherever on
 * the pool it happens — the same property a coordinate axis needs, for the same
 * reason — and snapping to a chromatic scale would make the steps alternate
 * between four and five semitones at nine notes, which is a quarter more interval
 * on every other step. Notes sound in isolation here, one per trial, so there is
 * nothing for them to be in tune WITH except the step before them, which is the
 * thing being held even.
 *
 * A *coordinate* pool is a different object with different requirements — few
 * levels, maximally far apart — and stays in COORD_POOLS above, untouched by
 * any of this.
 */
const TONE_BASE = 220;        // A3, the bottom of the span
const TONE_SEMITONES = 36;    // three octaves, so the top is A6 at 1760 Hz
/*
 * Four is where a fresh player starts: octaves, which is as far apart as two
 * notes inside one span can be. Twelve is three semitones a step — a minor
 * third, still a musical interval and still placeable, and past it the pool
 * stops being a scale you can hold and becomes a pitch-matching test.
 *
 * Three exists only so that a record written before this was a setting restores
 * onto the pool it was actually played with.
 */
const TONE_MIN = 3, TONE_MAX = 12, TONE_DEFAULT = 4;

/** The count, clamped, for a config that may predate the setting. */
const toneCount = c => {
  const n = Math.round(((c || cfg).toneCount) || TONE_DEFAULT);
  return Math.min(TONE_MAX, Math.max(TONE_MIN, n));
};

/* Memoised: the pool is read on every trial and on every judgement, and a pool
   is fully determined by its count. */
const tonePools = {};
function tonePool(n) {
  n = Math.min(TONE_MAX, Math.max(TONE_MIN, Math.round(n) || TONE_DEFAULT));
  if (tonePools[n]) return tonePools[n];
  const out = [];
  for (let i = 0; i < n; i++) {
    /* Rounded to a tenth of a hertz, which is a thousandth of a semitone at the
       bottom of the span and less above it — tidy to print, and far below
       anything a step is measured in. */
    const semis = TONE_SEMITONES * i / (n - 1);
    out.push(Math.round(TONE_BASE * Math.pow(2, semis / 12) * 10) / 10);
  }
  return (tonePools[n] = out);
}

/* The pool a fresh profile plays with: A3 A4 A5 A6, low → high. Named because
   the tools reach for it, and because "the default pool" is a thing worth being
   able to say. */
const PITCHES = tonePool(TONE_DEFAULT);

/** How far apart two neighbouring tones are, in semitones, for the hints. */
const toneStepSemitones = n => Math.round(TONE_SEMITONES / (Math.max(2, n) - 1) * 10) / 10;

/*
 * How much louder the bottom of the pool is than the top, when the option is on.
 *
 * A second cue on the same axis, running the other way: down is lower *and*
 * louder. Redundant on purpose — two cues agreeing is easier to read than one,
 * and the direction only has to be sensed, not deduced.
 *
 * Deeper is louder rather than quieter for a reason beyond preference: low tones
 * are heard as quieter at equal amplitude, and small speakers lose the bottom
 * octave first, so the gain is partly buying back the loudness the frequency
 * gave away.
 */
const PITCH_LOUDNESS_RANGE = 1.7;

/** Gain multiplier for a pitch index, or 1 when the option is off. */
function pitchLevel(i, c) {
  c = c || cfg;
  const pool = poolFor('pitch', c);
  if (!c.pitchLoudness || i == null || pool.length < 2) return 1;
  /* 1 at the top of the pool, `RANGE` at the bottom. Clamped, because the pool
     can narrow under a trial that was drawn against a wider one. */
  const t = 1 - Math.min(i, pool.length - 1) / (pool.length - 1);
  return 1 + t * (PITCH_LOUDNESS_RANGE - 1);
}
/* Timbre voices. Every set is FOUR voices ordered dull → bright, because the deck
   labels them "Brighter"/"Duller" and a relational answer is only defined on an
   ordered scale. The ordering is by spectral centroid, measured by rendering each
   voice offline at all four pitches rather than assumed — the first attempt at the
   vowel set was monotone on average and scrambled at individual pitches, which is the
   worst thing such a scale can be.

   `level` equalises loudness, also measured: a square is nearly twice the RMS of a
   sawtooth, so without it the stream would be partly answerable by volume.

   `partials` are harmonic amplitudes (fundamental first) turned into a PeriodicWave,
   which is defined in ratios and so sounds the same at every pitch. `formants` are
   resonances given as MULTIPLES OF THE FUNDAMENTAL for the same reason: real vowels
   use absolute frequencies, and a fixed resonance sits on a different harmonic for
   every note, which is exactly what broke the ordering. The cost is that these read as
   vowel colours rather than speech; the spoken-letter stream is where real voices
   live. */
const VOICE_SETS = {
  waves: {
    label: 'Waveforms',
    voices: [
      { osc:'sine',     level: 0.78 },
      { osc:'triangle', level: 0.95 },
      { osc:'square',   level: 0.65 },
      { osc:'sawtooth', level: 1.13 },
    ],
  },
  reeds: {
    label: 'Instruments',
    voices: [
      { level: 0.77, partials: [1, .04, .01] },                          // flute
      { level: 0.63, partials: [1, 0, .32, 0, .12, 0, .05] },            // clarinet
      { level: 1.15, partials: [1, .55, .42, .34, .26, .19, .13, .09] }, // horn
      { level: 1.77, partials: [.5, .25, .7, .4, 1, .5, .85, .6, .7] },  // bell
    ],
  },
  vowels: {
    label: 'Vowels',
    voices: [
      { osc:'sawtooth', level: 1.10, formants: [[0.9, 11, 3.4], [2.2, 9, 0.8]] }, // oo
      { osc:'sawtooth', level: 1.07, formants: [[2.0, 11, 2.6], [3.4, 9, 1.4]] }, // ah
      { osc:'sawtooth', level: 3.27, formants: [[1.6, 11, 1.8], [5.2, 9, 2.0]] }, // eh
      { osc:'sawtooth', level: 2.49, formants: [[0.9, 11, 1.2], [7.5, 9, 2.8]] }, // ee
    ],
  },
};
/* Read live rather than snapshotted: `cfg` does not exist yet in this file, and the
   set can change between blocks. All sets are the same length, so switching never
   changes how many timbre levels the ladder is working with. */
const voiceSet = () => VOICE_SETS[cfg.voiceSet] || VOICE_SETS.waves;
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
const BUILD = '2026-09-21.1';

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
  /*
   * Two relations held at once across different spaces pushes past quaternary.
   *
   * Gated on position being relational, which is what it always meant and never
   * said: `meta` and `frame` are both dead settings while position is off or
   * judged as identity, and this used to report quinary for a configuration
   * that asked no relational question at all.
   *
   * It is also, now, a claim the scoring backs, and one the cube has to earn by
   * turning — see `dualFrameLive`. For as long as the meta branch of
   * `buildJudgments` swallowed `frame` whole, this line named a tier that
   * nothing measured: the HUD printed "quinary" over a block asking exactly the
   * quaternary question. Both frames are asked and scored separately now, and a
   * still cube — where the second answer is the first one restated — is named
   * for the quaternary it is.
   */
  if (dualFrameLive(c)) rc = 5;
  return rc || 2;
}

/*
 * Whether the two frames can actually disagree.
 *
 * A rotation preserves angles, so the relation between two moves is the SAME
 * number in every frame that is related to the cube's by one — the screen answer
 * only departs from the cube answer over a turn the cube made BETWEEN the two
 * moves. With a still cube the second judgement is the first one copied out, and
 * quinary would be quaternary charging twice for one binding.
 */
function dualFrameLive(c) {
  c = c || cfg;
  return !!(c.meta && c.streams.position === 'relational' &&
            c.frame === 'both' && c.rotation);
}

const TARGET_RATE = 0.28;  // forced identity matches
const EPS         = 0.20;  // "no movement on this axis" threshold, unit-normalised
const LURE_MIN = 0.10, LURE_MAX = 0.50;   // beyond ~0.5 the lure becomes the norm
const LURE_MIN_TRIALS = 4;                // don't adapt the rate on 1–2 noisy trials
const RETRO_MIN_RESPONSE = 700;           // ms left to answer after the cue appears
const RETRO_MIN_INTERVAL = 1300;          // below this a retro trial can't be answered

/*
 * The share of trials each meta-relation should be the answer on.
 *
 * A weight over the AVAILABLE types cannot deliver a share, which is what the
 * `{ same: 3, opp: 3, diff: 1, obl: 1 }` this replaces was trying to do.
 * Measured over a stationary walk on a 3-cube, how often a relation is even
 * reachable from where the cube stands: opposite 100% of trials, oblique 100%,
 * orthogonal 97% — and `same`, which means continuing straight, 33%, because a
 * wall is in the way on two trials in three. A weight spread over what is left
 * then redistributes same's mass proportionally, and opposite, carrying the
 * same weight, collects most of it. That is how raising `same` to 3 produced
 * opposite on 53% of trials while `same`, the answer the raise was for, stayed
 * at 13%.
 *
 * An even split is what `pickMetaType` aims at, by drawing against what the
 * block still owes rather than against a fixed weight. Over a long run it lands
 * exactly; over one block of twenty it does not, and cannot — taking `same`
 * whenever it is offered walks the cube further into the wall that blocks it
 * next time, so its own availability falls as the deficit is repaid, and
 * sixteen scored trials is too short a block to finish repaying. Measured over
 * four thousand blocks at the defaults:
 *
 *     before   same 12.4%   opp 52.0%   diff 17.4%   obl 18.1%
 *     after    same 18.1%   opp 27.2%   diff 27.3%   obl 27.4%
 *
 * The target stays even rather than being bent to the 18/27 the lattice
 * actually yields, because the shortfall is the 3-cube's and not the draw's —
 * a 4-cube offers `same` on half of trials and gets closer on its own, and
 * bending the target would hide that.
 */
const META_SHARE = { same: 0.25, opp: 0.25, diff: 0.25, obl: 0.25 };
/* Every available relation keeps some chance on every trial, so a block can
   never be read by counting which answer is overdue. */
const META_FLOOR = 0.05;

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
       memory load is what actually rises.

       Three channels for four relations, too. Oblique — neither aligned with the
       previous move nor square to it — is answered by pressing nothing, so the
       relation set can be widened without widening the deck. That is the only
       direction this mode can grow in: at quaternary the buttons are already the
       part of the task the player has least room for. */
    meta: [
      { id:'meta-same', glyph:'⇉', label:'Same direction',  key:'w', color:'#51cf66' },
      { id:'meta-opp',  glyph:'⇄', label:'Opposite',        key:'s', color:'#ff6b6b' },
      /*
       * Orthogonal, not "different". The other two name a relation — same
       * direction, opposite direction — and this one named the leftovers, which
       * is a category rather than a relation and cannot be reasoned with.
       *
       * The predicate is unchanged, and today it is exactly the same one:
       * `cardinalOf` reduces a move to one axis and a sign, so a different axis
       * *is* a zero dot product. The name matters for what comes next. There are
       * as many mutually orthogonal directions as there are dimensions, so a
       * fourth axis gives a third way to be orthogonal instead of a second —
       * the response set stays at three while the state behind it grows, which
       * is difficulty that costs no buttons.
       *
       * The id stays `meta-diff`: it is written into stored blocks, and renaming
       * it would silently orphan every one of them.
       */
      { id:'meta-diff', glyph:'⤢', label:'Orthogonal',  key:'d', color:'#fcc419' },
      /*
       * The fourth relation, oblique, has no entry here on purpose — it is
       * stated by pressing none of the three above.
       *
       * A button for it would be worse than useless: it would turn a derivation
       * into a recognition, since "none of these" is the one answer you can
       * reach by elimination rather than by holding the earlier move. Left off
       * the deck, the only way to know an angle is neither 0°, 180° nor 90° is
       * to have the earlier move to measure against.
       */
    ],
    /*
     * The meta relation asked in the screen frame — its own three buttons,
     * because at quinary both frames are answered on the same trial and one
     * shared set could not state two different relations.
     *
     * Screen-frame keys, matching `relationalScreen`'s cluster rather than the
     * cube meta's WASD, so the hand that answers "what did it do on screen" is
     * the same hand in both orders of the judgement.
     *
     * Oblique has no button here either, for the reason it has none there.
     */
    metaScreen: [
      { id:'s-meta-same', glyph:'⇉', label:'Same direction',  key:'i', color:'#51cf66' },
      { id:'s-meta-opp',  glyph:'⇄', label:'Opposite',        key:'k', color:'#ff6b6b' },
      { id:'s-meta-diff', glyph:'⤢', label:'Orthogonal',      key:'l', color:'#fcc419' },
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
  /* The classic n-back audio channel, and the only stream here with no relational
     form: every other stimulus is a scale with an up and a down, but letters are
     names. "Was it the same letter" is the whole question. */
  letter: {
    label: 'Spoken letter', color: '#9ccc65', idOnly: true,
    identity: [{ id:'letter', glyph:'\u{1F5E3}', label:'Same', key:'j' }],
    relational: [],
  },
};
const STREAM_KEYS = Object.keys(STREAMS);

/* Eight letters, not twenty-six, and chosen to spread across both the onset and the
   vowel: the alphabet's own rhyme groups (B/C/D/E/G/P/T/V/Z, and A/H/J/K) would turn
   an identity judgement into a listening test. */
const LETTER_KEYS = ['A', 'F', 'L', 'O', 'Q', 'R', 'X', 'Y'];
const LETTER_VOICES = { slt: 'Female', rms: 'Male', awb: 'Male, Scottish', kal: 'Synthetic' };

/* Extra scoring buckets that aren't user-configurable streams. */
const EXTRA_LABELS = { position2: 'Position (screen)' };
const labelFor = k => (STREAMS[k] ? STREAMS[k].label : EXTRA_LABELS[k]) || k;
const colorFor = k => (STREAMS[k] ? STREAMS[k].color : '#9ccc65');

/* Keys are assigned dynamically from this pool when a preferred key collides —
   enabling many streams at once (or "both frames") otherwise double-books keys. */
const KEY_POOL = ('qwertyuiopasdfghjkl;zxcvbnm,./1234567890').split('');

/* Every response channel in the app, tagged with the stream + mode slot it lives in.
   This is the list the keybind editor walks. */
/* The meta modes belong here as much as the first-order ones: they are response
   buttons with default keys, and leaving them out meant the keybind editor could
   not see the only channels in the app that a quaternary block is answered on. */
const CHANNEL_MODES = ['identity', 'relational', 'relationalScreen', 'meta', 'metaScreen'];
const CHANNELS = STREAM_KEYS.flatMap(k =>
  CHANNEL_MODES.flatMap(mode =>
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
  /* The two pairs that are both live at once: first-order position in "both
     frames", and — at quinary — the meta relation asked in both frames. Every
     other pair is two modes of one stream, and a stream is in exactly one mode
     at a time, so a shared default key there is deliberate. */
  const pair = [a.mode, b.mode].sort().join('|');
  return a.stream === 'position' &&
         (pair === 'relational|relationalScreen' || pair === 'meta|metaScreen');
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

/* ---- App shortcuts ----
   The deck keys above answer the task; these drive the session around it. They are
   kept in their own table rather than folded into CHANNELS because they are always
   live: a response key only exists while its stream is switched on, whereas Stop has
   to work in every configuration. What each one does, and when it is allowed to do
   it, lives with the rest of the wiring in ACTION_RUN.

   Defaults are chosen from keys no response channel claims, so a fresh install never
   ships a shortcut that a deck button is already sitting on. Pause ships unbound on
   purpose: it discards the trial on screen, and there is no letter left that is far
   enough from the response cluster to be safe to press by accident. Anyone who wants
   it can give it a key here — which is rather the point of this panel. */
const ACTIONS = [
  { id:'start',    key:'enter',  label:'Start block',
    hint:'Ignored while a block is already running.' },
  { id:'stop',     key:'escape', label:'Stop block',
    hint:'Ends the block without scoring it.' },
  { id:'pause',    key:null,     label:'Pause / resume',
    hint:'Unbound by default. Pausing is handled exactly like losing the tab: the ' +
         'trial on screen is discarded and the block is flagged interrupted, so it ' +
         'cannot buy thinking time mid-trial.' },
  { id:'settings', key:'c',      label:'Open / close settings',
    hint:'Toggles the panel, wherever you are. Does not stop a running block.' },
];
const ACTION_BY_ID = Object.fromEntries(ACTIONS.map(a => [a.id, a]));

let actionBinds = {};                     // actionId -> key, or null for unbound

/* An own property always wins, INCLUDING an explicit null. That null is what makes
   an action unbound rather than falling back to its default — rebindAction relies on
   it when a key is taken off an action that had no default to return to. */
const effectiveAction = id =>
  Object.prototype.hasOwnProperty.call(actionBinds, id)
    ? actionBinds[id] || null
    : (ACTION_BY_ID[id] || {}).key || null;

/* Every shortcut key currently spoken for. buildDeck() reads this so its automatic
   pool assignment never quietly swallows one. */
const reservedActionKeys = () =>
  new Set(ACTIONS.map(a => effectiveAction(a.id)).filter(Boolean));

/* The action a key fires, or undefined. Unlike channels, no two shortcuts can share
   a key — there is no "only one of these is on screen at a time" to make sharing
   safe — so a rebind hands the old key to whoever held the new one. */
const actionForKey = key =>
  key ? ACTIONS.find(a => effectiveAction(a.id) === key) : undefined;

function rebindAction(id, key) {
  const old = effectiveAction(id);
  const holder = ACTIONS.find(a => a.id !== id && effectiveAction(a.id) === key);
  if (holder) actionBinds[holder.id] = old;     // null when `id` was itself unbound
  actionBinds[id] = key;
  /* A shortcut releasing a key can free the deck to stop avoiding it, and claiming
     one can force a deck button off it — so the deck is rebuilt either way. */
  buildDeck(); renderKeybinds(); renderShortcuts(); saveProgress();
}

function clearActionBind(id) {
  delete actionBinds[id];                       // back to the built-in default
  buildDeck(); renderKeybinds(); renderShortcuts(); saveProgress();
}
