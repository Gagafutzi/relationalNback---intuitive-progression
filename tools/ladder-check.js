#!/usr/bin/env node
/*
 * The target-accuracy setting, checked against the staircase it drives.
 *
 * `ladder.js` is loaded on its own in a sandbox with nothing but a `tune` object,
 * which is all it needs for the parts under test -- so this runs without a browser,
 * a DOM or a build step:  node tools/ladder-check.js
 *
 * What it is guarding, in order of how badly each would have gone unnoticed:
 *
 *  · The default has to reproduce the old fixed numbers exactly. A new setting that
 *    quietly changes behaviour before anybody touches it is the worst kind.
 *  · `psi(T, T)` must equal the target, or the grid parameter stops being "the
 *    interval at which you score the target" and every printed threshold is a lie.
 *  · Retargeting must translate the posterior rather than reinterpret it. The
 *    stored evidence is about a criterion; change the criterion without moving the
 *    grid and months of blocks silently start claiming to be about a different one.
 *  · The clamp has to hold, because `stairC` divides by `(1 - lapse) - target` and
 *    a target at or above 0.97 makes the whole model infinite.
 */

const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');

const ctx = vm.createContext({ console, Math, Array, Object, JSON });
// Only what ladder.js reaches for.
vm.runInContext('var TUNE_DEFAULTS = { targetAccuracy: 0.40 };', ctx);
vm.runInContext('var tune = { startInterval: 5000, targetInterval: 3000, maxInterval: 6500, nMax: 3, targetAccuracy: 0.40 };', ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ladder.js'), 'utf8'), ctx);
const g = k => vm.runInContext(k, ctx);
const set = (k, v) => vm.runInContext(`tune.targetAccuracy = ${v};`, ctx);

const LEGACY = 0.80;   // what every pre-setting record was fitted at
let bad = 0;
const ok = (name, cond, extra='') => { console.log((cond?'  ok   ':'  FAIL ') + name + (cond?'':'  '+extra)); if(!cond) bad++; };
const near = (a, b, tol=1e-9) => Math.abs(a-b) <= tol;

// 1. The band is the target plus its margins, whatever the target is.
ok('the band brackets the target',
   near(g('advanceAt()'), g('targetAccuracy()') + 0.05, 1e-9) &&
   near(g('demoteAt()'), g('targetAccuracy()') - 0.10, 1e-9),
   `target=${g('targetAccuracy()')} advance=${g('advanceAt()')} demote=${g('demoteAt()')}`);

/*
 * The scale the band has to live on -- the bug this file exists to keep out.
 *
 * `streamScore` maps "never pressed" to 0 and perfect to 1, and for the
 * relational position stream the never-press rate is 2/3 by construction: three
 * axis judgments per interval, one of them non-empty for an axis-aligned move.
 * So a raw accuracy `a` scores (a - 2/3) / (1/3), and a band chosen as though
 * the score were a raw accuracy is a band nobody can sit inside. At the original
 * 0.85 / 0.70 a player answering 85% of judgments exactly right scored 55% and
 * was told to ease off on every block.
 *
 * Written as a reachability check rather than as fixed numbers, so it keeps
 * meaning the same thing if the target is retuned again.
 */
const POSITION_CHANCE = 2 / 3;
const corrected = a => (a - POSITION_CHANCE) / (1 - POSITION_CHANCE);
const rawFor = s => POSITION_CHANCE + s * (1 - POSITION_CHANCE);

const holdLo = rawFor(g('demoteAt()')), holdHi = rawFor(g('advanceAt()'));
console.log(`   hold band is ${(holdLo * 100).toFixed(0)}%-${(holdHi * 100).toFixed(0)}%`
  + ` of judgments answered exactly right (target ${(rawFor(g('targetAccuracy()')) * 100).toFixed(0)}%)`);

ok('a player at the target scores inside the hold band',
   corrected(rawFor(g('targetAccuracy()'))) > g('demoteAt()') &&
   corrected(rawFor(g('targetAccuracy()'))) < g('advanceAt()'));
ok('the hold band sits where a human can actually play',
   holdLo >= 0.60 && holdHi <= 0.95,
   `${(holdLo * 100).toFixed(0)}%-${(holdHi * 100).toFixed(0)}% raw is not a band anyone sits in`);
ok('easing off means genuinely below target, not merely imperfect',
   holdLo > POSITION_CHANCE + 0.02 && holdLo < 0.85,
   `eases off below ${(holdLo * 100).toFixed(0)}% raw`);

// 2. The grid parameter IS the threshold, at any target.
let curveOk = true, band = [];
for (const p of [0.20, 0.35, 0.40, 0.55, 0.75, 0.90]) {
  set('t', p);
  const T = 3.5;
  if (!near(g(`psi(${T}, ${T})`), p, 1e-12)) curveOk = false;
  band.push([p, +g('advanceAt()').toFixed(3), +g('demoteAt()').toFixed(3)]);
}
ok('psi(T,T) equals the target at every setting', curveOk);
ok('the band follows the target', band.every(([p,a,d]) => near(a, Math.min(0.98,p+0.05), 1e-6) && near(d, Math.max(0.02,p-0.10), 1e-6)),
   JSON.stringify(band));

// 3. Out-of-range values are clamped rather than making stairC infinite.
set('t', 0.99);
ok('a target above the lapse ceiling is clamped', g('targetAccuracy()') === 0.90 && isFinite(g('stairC()')),
   `${g('targetAccuracy()')} / ${g('stairC()')}`);
set('t', 0.01);
ok('a target below the floor is clamped', g('targetAccuracy()') === 0.20);

// 4. Retargeting preserves the fitted curve.
set('t', 0.40);
vm.runInContext('stairInit(5000);', ctx);
// Some evidence: 14 of 20 at 3.2s, twice.
vm.runInContext('stairObserve(Math.log10(3200), 14, 20); stairObserve(Math.log10(3200), 15, 20);', ctx);
const T0 = g('stairMeanT()');
// Predicted performance across the interval range, under the old criterion.
const xs = [3.0, 3.2, 3.4, 3.6, 3.8];
const before = xs.map(x => g(`psi(${x}, ${T0})`));

set('t', 0.70);
vm.runInContext('stairRetarget(0.40, 0.70);', ctx);
const T1 = g('stairMeanT()');
const after = xs.map(x => g(`psi(${x}, ${T1})`));

const expectedShift = (Math.log(0.70/(0.97-0.70)) - Math.log(0.40/(0.97-0.40))) / 6.0;
ok('the posterior shifts by exactly (C_new - C_old)/beta',
   near(T1 - T0, expectedShift, 2e-3), `moved ${(T1-T0).toFixed(5)}, expected ${expectedShift.toFixed(5)}`);
ok('aiming higher puts the threshold at a slower interval', T1 > T0,
   `${(10**T0).toFixed(0)}ms -> ${(10**T1).toFixed(0)}ms`);
ok('the fitted performance curve itself is unchanged',
   before.every((v, i) => near(v, after[i], 2e-2)),
   JSON.stringify({before: before.map(v=>+v.toFixed(3)), after: after.map(v=>+v.toFixed(3))}));

console.log(`\nthreshold at 40%: ${(10**T0/1000).toFixed(2)}s   at 70%: ${(10**T1/1000).toFixed(2)}s`);

// 5. Retargeting back returns to where it started.
vm.runInContext('stairRetarget(0.70, 0.40);', ctx);
set('t', 0.40);
ok('retargeting back is a round trip', near(g('stairMeanT()'), T0, 3e-3),
   `${g('stairMeanT()').toFixed(5)} vs ${T0.toFixed(5)}`);

// 6. A no-op call and a missing posterior are both safe.
vm.runInContext('stairRetarget(0.40, 0.40);', ctx);
const T2 = g('stairMeanT()');
ok('retargeting to the same value changes nothing', near(T2, g('stairMeanT()')));
vm.runInContext('stairLog = null; stairRetarget(0.40, 0.70);', ctx);
ok('retargeting with no posterior yet does not throw', g('stairLog') === null);

/*
 * The migration every record written before the target was a setting goes
 * through on its first load. Last, because it replaces the posterior the checks
 * above share.
 */
set('t', LEGACY);
vm.runInContext('stairInit(4000);', ctx);
const legacyT = g('stairMeanT()');
vm.runInContext('stairRetarget(LEGACY_P_TARGET, 0.40);', ctx);
set('t', 0.40);
const adoptedT = g('stairMeanT()');
ok('a record fitted at the old target is re-read, not relabelled', adoptedT < legacyT,
   `${(10 ** legacyT).toFixed(0)}ms at ${LEGACY} -> ${(10 ** adoptedT).toFixed(0)}ms at 0.40`);
ok('the constant the migration reads is the criterion those records were fitted at',
   g('LEGACY_P_TARGET') === LEGACY, `LEGACY_P_TARGET=${g('LEGACY_P_TARGET')}`);
console.log(`   a stored 4.00s threshold at the old criterion reads as `
  + `${(10 ** adoptedT / 1000).toFixed(2)}s at the new one`);

/* ------------------------------------------------------------------ *
 * What the report says about a score                                  *
 * ------------------------------------------------------------------ */

/*
 * The colours and the criterion have to move with the target too.
 *
 * They did not. `barColor` was fixed at 0.85 and 0.70 and `progressSummary` held
 * a `CRIT = 0.80`, all three of which were the right numbers while every block
 * aimed at 80%. At the 40% default a cleared milestone was painted red for
 * scoring 56%, and "Load held" read "no block at ≥80% yet" for everybody
 * permanently, because no block at that target ever scores 0.80.
 *
 * Checked by reading the source rather than by calling it: both files reach for
 * the DOM at load, and what went wrong is a literal in the file, which is
 * exactly what a source scan can see.
 */
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const hud = src('js/hud.js');
const barLine = (hud.match(/const barColor = [^;]*;/) || [''])[0];
ok('the report colours a score against the target, not against 80%',
   /advanceAt\(\)/.test(barLine) && /demoteAt\(\)/.test(barLine)
     && !/0\.\d/.test(barLine.replace(/#[0-9a-f]{6}/gi, '')),
   `barColor reads: ${barLine || '(not found)'}`);

const crit = (src('js/analysis.js').match(/const CRIT = [^;]*;/) || [''])[0];
ok('"load held" is held to the score that would advance you',
   /advanceAt\(\)/.test(crit), `CRIT reads: ${crit || '(not found)'}`);

/* ------------------------------------------------------------------ *
 * What the meta relations are called                                  *
 * ------------------------------------------------------------------ */

/*
 * "Same direction" and "Opposite" name relations; the third named the leftovers.
 * A residual category cannot be reasoned with — and it is not a residual, it is
 * orthogonality: `cardinalOf` reduces a move to one axis and a sign, so a
 * different axis is a zero dot product exactly.
 *
 * Checked because the payoff is dimensional and arrives later. There are as
 * many mutually orthogonal directions as dimensions, so a fourth axis gives a
 * third way to be orthogonal rather than a second, and the response set stays
 * at three while the state behind it grows.
 */
const meta = fs.readFileSync(path.join(ROOT, 'js/constants.js'), 'utf8');
ok('the third meta relation is named for what it is',
   /id:'meta-diff'[^}]*label:'Orthogonal'/.test(meta),
   'the third option still names the leftovers rather than the relation');
ok('its id is untouched, so stored blocks still resolve',
   /id:'meta-diff'/.test(meta),
   'renaming the id orphans every block already recorded under it');


/* ------------------------------------------------------------------ *
 * The fourth axis                                                     *
 * ------------------------------------------------------------------ *
 *
 * Pitch as a coordinate of the move rather than a stream beside it. The point
 * is orthogonality: there are as many mutually orthogonal directions as there
 * are dimensions, so a fourth axis gives a third way to be orthogonal instead
 * of a second — the answers stay at three while the space behind them grows,
 * which is the only kind of difficulty that costs no buttons.
 *
 * Driven through a sandbox rather than a browser, so it needs the geometry the
 * real app builds. `state.cells` is stood up here as the lattice it would be.
 */
const geo = vm.createContext({ console, Math, Array, Object, JSON });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/constants.js'), 'utf8')
  .replace(/^"use strict";/, ''), geo);

/* A 3×3×3 lattice, which is what `dim: 3` builds. */
vm.runInContext(`
  /* frame belongs here because the meta judgement reads it now: before, it was
     the first arm of a chain that never consulted it, so "both frames" asked the
     one cube-frame question. A stub without it asks no position question at all. */
  var cfg = { coordAxes: ['pitch'], magnitudeCap: 2, frame: 'cube',
              streams: { position: 'relational' } };
  /* What geometry.js supplies in the browser. Real arithmetic against a plain
     rotation matrix — DOMMatrixReadOnly is exactly a transformPoint to the one
     caller here, so the stub is the same shape and not a stand-in. */
  var projectScreen = function (d, m) {
    if (!m) return d;
    var p = m.transformPoint({ x: d[0], y: d[1], z: d[2], w: 0 });
    return [p.x, p.y, p.z];
  };
  var normalise = function (v) {
    var m = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
    return m < 1e-6 ? [0,0,0] : [v[0]/m, v[1]/m, v[2]/m];
  };
  /* A turn of deg about the screen's vertical, which is what the cube spinning
     between two trials does to the picture. */
  var spin = function (deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { transformPoint: function (p) {
      return { x: c * p.x + s * p.z, y: p.y, z: -s * p.x + c * p.z }; } };
  };
  var state = { cells: [] };
  for (var x = 0; x < 3; x++) for (var y = 0; y < 3; y++) for (var z = 0; z < 3; z++)
    state.cells.push({ x: x, y: y, z: z });
  var idx = function (x, y, z) {
    for (var i = 0; i < state.cells.length; i++) {
      var c = state.cells[i];
      if (c.x === x && c.y === y && c.z === z) return i;
    }
    return -1;
  };
`, geo);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/judgments.js'), 'utf8')
  .replace(/^"use strict";/, ''), geo);

const g4 = k => vm.runInContext(k, geo);

/*
 * A coordinate step is a direction like any other, and it borrows the stream's
 * own relational channel ids for its poles — no new buttons, no new keys.
 */
ok('a coordinate step is named as a direction of its own',
   g4(`cardinalId(cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 },
                             { cellIdx: idx(1,1,1), pitch: 2 }))`) === 'pitch-up',
   'a move up the pool was not read as a move');
ok('and downward too',
   g4(`cardinalId(cardinalOf({ cellIdx: idx(1,1,1), pitch: 2 },
                             { cellIdx: idx(1,1,1), pitch: 1 }))`) === 'pitch-down');

/* Each of the four properties can be the coordinate, not just the tone. */
['pitch', 'color', 'size', 'quantity'].forEach(k => {
  vm.runInContext(`cfg.coordAxes = ['${k}'];`, geo);
  const poles = g4(`coordPoles('${k}')`);
  ok(`${k} can be an axis of the move`,
     g4(`cardinalId(cardinalOf({ cellIdx: idx(1,1,1), ${k}: 0 },
                               { cellIdx: idx(1,1,1), ${k}: 1 }))`) === poles[0],
     `a step on ${k} was not read as a move`);
  ok(`and it names itself with ${k}'s own two channels`,
     poles.every(p => typeof p === 'string' && p) && poles[0] !== poles[1],
     `poles ${JSON.stringify(poles)} — a coordinate needs no invented ids`);
});

/* Several at once, which is what makes five, six and seven dimensions. */
vm.runInContext("cfg.coordAxes = ['pitch', 'size', 'quantity'];", geo);
ok('the count of axes is the cube plus whatever was chosen',
   g4('dimCount()') === 6, `dimCount() reads ${g4('dimCount()')}`);
ok('and a later coordinate is still its own axis',
   g4(`cardinalId(cardinalOf({ cellIdx: idx(1,1,1), pitch: 0, size: 0, quantity: 0 },
                             { cellIdx: idx(1,1,1), pitch: 0, size: 0, quantity: 1 }))`)
     === g4("coordPoles('quantity')[0]"),
   'the third coordinate is being read on somebody else\'s axis');
vm.runInContext("cfg.coordAxes = ['pitch'];", geo);

ok('the three cube axes still read as they did',
   g4(`cardinalId(cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 },
                             { cellIdx: idx(2,1,1), pitch: 1 }))`) === 'east',
   'adding a fourth component changed what a spatial move is called');

/*
 * The invariant a *named* move rests on: it is on exactly one axis. Moving the
 * cell *and* the pitch names nothing, which is what makes the generator draw
 * the axis rather than filter for it afterwards. (Composite moves are still
 * drawn — they are measured as vectors, and simply have no cardinal name.)
 */
ok('a move on two axes at once is not a direction',
   g4(`cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 },
                   { cellIdx: idx(2,1,1), pitch: 2 })`) === null,
   'a diagonal through space and pitch was given a name');

ok('a coordinate step is invisible when nothing is a coordinate',
   (vm.runInContext('cfg.coordAxes = [];', geo),
    g4(`cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 },
                    { cellIdx: idx(1,1,1), pitch: 2 })`) === null),
   'a coordinate axis is being read when none was chosen');
vm.runInContext("cfg.coordAxes = ['pitch'];", geo);

/* Given a move east, the axes orthogonal to it: two at three dimensions, three
   at four. That count *is* the feature. */
const orth = d => {
  vm.runInContext(`cfg.coordAxes = ${d >= 4 ? "['pitch']" : '[]'};`, geo);
  return g4(`(function () {
    var A = cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 },
                       { cellIdx: idx(2,1,1), pitch: 1 });
    var moves = [
      { cellIdx: idx(1,0,1), pitch: 1 }, { cellIdx: idx(1,2,1), pitch: 1 },
      { cellIdx: idx(1,1,0), pitch: 1 }, { cellIdx: idx(1,1,2), pitch: 1 },
      { cellIdx: idx(1,1,1), pitch: 0 }, { cellIdx: idx(1,1,1), pitch: 2 },
    ];
    var axes = {};
    moves.forEach(function (m) {
      var c = cardinalOf({ cellIdx: idx(1,1,1), pitch: 1 }, m);
      if (c && c[0] !== A[0]) axes[c[0]] = true;
    });
    return Object.keys(axes).length;
  })()`);
};
ok('three dimensions leave two ways to be orthogonal', orth(3) === 2,
   `counted ${orth(3)}`);
ok('four dimensions leave three', orth(4) === 3,
   `counted ${orth(4)} — the fourth axis is not reaching the relation`);

/* Nothing is judged twice. */
const st = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8');
ok('a coordinate cannot also be a stream',
   (function () {
     /* Run the real guard rather than read it: lifted out of state.js, because
        state.js declares a cfg of its own that would collide with the sandbox's. */
     const src = st.slice(st.indexOf('function applyDimensions'));
     vm.runInContext(src.slice(0, src.indexOf('\n}') + 2), geo);
     return g4(`(function () {
       var c = { coordAxes: ['pitch', 'size'],
                 streams: { position: 'relational', pitch: 'identity',
                            size: 'relational', color: 'identity' } };
       applyDimensions(c);
       return Object.keys(c.streams).sort().join(',');
     })()`) === 'color,position';
   })(),
   'a property is being judged both as a coordinate and as a stream');
const blk = fs.readFileSync(path.join(ROOT, 'js/block.js'), 'utf8');
ok('and the guard runs on both paths into a block',
   (blk.match(/applyDimensions\(cfg\)/g) || []).length >= 2,
   'progression or free play can still reach a block with pitch judged twice');


/* ------------------------------------------------------------------ *
 * The tones themselves                                               *
 * ------------------------------------------------------------------ */

ok('the tone axis offers three levels at the default cap',
   g4("COORD_POOLS.pitch[2].length") === 3);
ok('and four when the furthest step is three',
   g4("COORD_POOLS.pitch[3].length") === 4,
   'a step of three needs a level to reach');

/*
 * Equal intervals. A step has to read as one step wherever on the axis it
 * happens; a mixture of fourths and fifths makes the same displacement sound
 * different depending where it started, which a coordinate cannot afford.
 */
/*
 * Equal steps on every ordered axis, at every cap. A step has to read as one
 * step wherever on the axis it happens, and an uneven pool makes the same
 * displacement feel different depending where it started.
 *
 * Ratios for the ones discrimination scales on — pitch and size — and
 * differences for quantity, which is counted exactly rather than estimated.
 * Colour is a hue sweep and neither, so it is left out.
 */
[['pitch', 'ratio'], ['size', 'ratio'], ['quantity', 'diff']].forEach(([k, how]) => {
  [2, 3].forEach(cap => {
    const steps = g4(`(function () {
      var p = COORD_POOLS['${k}'][${cap}], out = [];
      for (var i = 1; i < p.length; i++) out.push(${how === 'ratio' ? 'p[i] / p[i-1]' : 'p[i] - p[i-1]'});
      return out;
    })()`);
    const spread = Math.max(...steps) / Math.min(...steps);
    ok(`${k} steps evenly at cap ${cap}`, spread < 1.15,
       `steps ${steps.map(x => x.toFixed(2)).join(', ')}`);
  });
});

/* Hue is a circle, so the sweep must stop short of wrapping or a step would
   sometimes reverse its own direction. */
ok('the colour axis does not wrap round to where it started',
   g4("COORD_POOLS.color[2][0]") !== g4("COORD_POOLS.color[2][2]"));

/* The second cue, and it runs the same way as the first: down is lower and louder. */
vm.runInContext('cfg.pitchLoudness = true;', geo);
ok('deeper is louder when it is asked for',
   g4('pitchLevel(0)') > g4('pitchLevel(1)') && g4('pitchLevel(1)') > g4('pitchLevel(2)'),
   `levels ${[0, 1, 2].map(i => g4(`pitchLevel(${i})`).toFixed(2)).join(', ')}`);
ok('and the top of the pool is left where it was',
   g4("pitchLevel(poolFor('pitch').length - 1)") === 1,
   'the option makes every tone louder rather than tilting them');

vm.runInContext('cfg.pitchLoudness = false;', geo);
ok('off, every tone is the level it always was',
   [0, 1, 2].every(i => g4(`pitchLevel(${i})`) === 1),
   'the option is doing something while switched off');


/* ------------------------------------------------------------------ *
 * The tone pool                                                       *
 * ------------------------------------------------------------------ *
 *
 * How many notes the tone STREAM draws from is a setting, and in Progression an
 * earned one. What has to hold however wide it gets: the span is fixed, so more
 * notes is finer steps rather than higher ones; the steps stay equal, so a step
 * reads as one step wherever on the scale it happens; and the coordinate pool —
 * a different object with different requirements — is untouched by any of it.
 */
vm.runInContext("cfg.coordAxes = [];", geo);

ok('a fresh profile gets four notes',
   g4('TONE_DEFAULT') === 4 && g4("poolFor('pitch', {}).length") === 4,
   'the pool nobody has chosen is not the one the ladder starts from');

ok('and they are octaves',
   (function () {
     const p4 = g4("poolFor('pitch', { toneCount: 4 })");
     return p4.every((f, i) => i === 0 || Math.abs(f / p4[i - 1] - 2) < 0.01);
   })(),
   'the starting pool is not as far apart as one span allows');

ok('the count is what the setting says',
   [3, 4, 7, 9, 12].every(n => g4(`poolFor('pitch', { toneCount: ${n} }).length`) === n),
   'the tone count does not reach the pool');

ok('and it is clamped at both ends',
   g4("poolFor('pitch', { toneCount: 99 }).length") === g4('TONE_MAX') &&
   g4("poolFor('pitch', { toneCount: 1 }).length") === g4('TONE_MIN'),
   'a hand-edited or corrupt count produces a pool nobody can play');

/* The span is what is held fixed. Dividing a range more finely is a
   discrimination task; extending it is an audibility one, and past a point it is
   neither — it is a test of the speakers. */
ok('every pool spans the same three octaves',
   [3, 4, 7, 12].every(n => {
     const p = g4(`poolFor('pitch', { toneCount: ${n} })`);
     return Math.abs(p[0] - 220) < 0.5 && Math.abs(p[p.length - 1] - 1760) < 1;
   }),
   'a wider pool is reaching for notes rather than dividing the ones it has');

/* Equal in ratio, because pitch discrimination is one — the same property the
   coordinate pools are checked for above, and for the same reason. Exactly equal,
   at every count: snapping the notes to a chromatic scale would buy tuning nobody
   can hear (the notes sound one per trial, alone) and pay for it in steps that
   alternate four and five semitones. */
[3, 4, 5, 7, 9, 10, 12].forEach(n => {
  const p = g4(`poolFor('pitch', { toneCount: ${n} })`);
  const ratios = [];
  for (let i = 1; i < p.length; i++) ratios.push(p[i] / p[i - 1]);
  ok(`${n} notes step evenly`,
     Math.max(...ratios) / Math.min(...ratios) < 1.001,
     `steps ${ratios.map(x => x.toFixed(4)).join(', ')}`);
});

/* A coordinate axis is a different object: few levels, maximally far apart. The
   stream setting must not reach it. */
ok('the coordinate pool is untouched by the stream setting',
   g4("poolFor('pitch', { coordAxes: ['pitch'], magnitudeCap: 2, toneCount: 12 }).length") === 3,
   'the tone count is resizing the axis pool, which is sized for a different job');


/* ------------------------------------------------------------------ *
 * Moves on several axes at once                                      *
 * ------------------------------------------------------------------ *
 *
 * A move used to be one axis, so "orthogonal" could only mean "a different
 * axis" — two of them in three dimensions, three in four. Composite moves make
 * it a dot product, and there are far more ways to satisfy one, which is the
 * difference between deriving the relation and reading off whichever axis moved.
 */
vm.runInContext("cfg.coordAxes = [];", geo);

ok('parallel is parallel, however many axes it runs on',
   g4(`metaRelationOf([1,1,0], [1,1,0])`) === 'same');
ok('antiparallel likewise',
   g4(`metaRelationOf([1,1,0], [-1,-1,0])`) === 'opp');
ok('a zero dot product is orthogonal, not "a different axis"',
   g4(`metaRelationOf([1,1,0], [-1,1,0])`) === 'diff',
   'two moves at right angles across two axes each were not read as orthogonal');
ok('and the axis-aligned case still is',
   g4(`metaRelationOf([1,0,0], [0,1,0])`) === 'diff');

/*
 * The fourth relation. (1,0,0) against (1,1,0) is 45° — neither the same
 * direction, nor reversed, nor a right angle — and it is a relation rather than
 * a gap: it is stated by pressing none of the three buttons.
 *
 * It used to come back null and be dropped by the generator, which restricted a
 * mode built on composite moves to the three special cases where a composite
 * move happens to behave like a single-axis one.
 */
ok('oblique is its own relation, not a missing one',
   g4(`metaRelationOf([1,0,0], [1,1,0])`) === 'obl',
   'a 45-degree relation did not come back as oblique');
ok('a move that goes nowhere still states no relation',
   g4(`metaRelationOf([1,0,0], [0,0,0])`) === null,
   'a move of zero length was given a relation');

/*
 * And the deck does not grow to hold it — the whole reason it can be added at
 * quaternary, where the buttons are the scarce resource. An oblique trial asks
 * the same three options with no correct answer among them.
 */
ok('an oblique trial asks the same three buttons and wants none of them',
   (function () {
     vm.runInContext("cfg.coordAxes = []; cfg.meta = true; cfg.streams.position = 'relational';", geo);
     const j = g4(`(function () {
       var p0 = { cellIdx: idx(0,1,1) }, p1 = { cellIdx: idx(1,1,1) };
       var b0 = { cellIdx: idx(1,1,1) }, b1 = { cellIdx: idx(2,2,1) };
       return buildJudgments(b0, b1, { metaPrev: [p0, p1] })
         .filter(function (x) { return x.stream === 'position'; })[0];
     })()`);
     return j && j.options.length === 3 && j.correct.length === 0;
   })(),
   'an oblique trial did not come out as a three-option question with an empty answer');
vm.runInContext("cfg.meta = false;", geo);

/* ------------------------------------------------------------------ *
 * Quinary: the same relation, asked in two frames                    *
 * ------------------------------------------------------------------ *
 *
 * The tier this file previously showed to be vapour. `relationalComplexity`
 * returned 5 for meta + both frames, `computeLoad` charged 34 for the second
 * frame, and `buildJudgments` read `cfg.frame` only in an arm the meta branch
 * had already short-circuited — so the block asked the one cube-frame question
 * and the HUD called it quinary.
 *
 * What makes the second frame worth asking is that a rotation preserves angles:
 * the relation between two moves is the SAME number in every frame related to
 * the cube's by one turn, so the screen answer departs from the cube answer only
 * over a turn the cube made BETWEEN the two moves. That is the invariant the
 * tier rests on, so it is checked directly rather than assumed.
 */
const metaJudgments = (frame, spinDeg) => {
  vm.runInContext(`cfg.coordAxes = []; cfg.meta = true; cfg.frame = '${frame}';
                   cfg.streams.position = 'relational';`, geo);
  return g4(`(function () {
    var m0 = spin(0), m1 = spin(${spinDeg});
    /* Previous move: east, seen with the cube at rest. This move: east again,
       seen after the cube has turned ${spinDeg} degrees. */
    var p0 = { cellIdx: idx(0,1,1), matrix: m0 }, p1 = { cellIdx: idx(1,1,1), matrix: m0 };
    var b0 = { cellIdx: idx(1,1,1), matrix: m1 }, b1 = { cellIdx: idx(2,1,1), matrix: m1 };
    return buildJudgments(b0, b1, { metaPrev: [p0, p1] })
      .filter(function (x) { return x.stream === 'position' || x.stream === 'position2'; })
      .map(function (x) { return [x.stream, x.options.join('|'), x.correct.join('|')]; });
  })()`);
};

ok('the cube frame alone asks one relation, as it always did',
   (function () { const j = metaJudgments('cube', 0);
     return j.length === 1 && j[0][0] === 'position'; })(),
   'meta in the cube frame stopped asking exactly one cube-frame question');

ok('and the screen frame alone asks it of the screen instead',
   (function () { const j = metaJudgments('screen', 0);
     return j.length === 1 && j[0][0] === 'position2' &&
            j[0][1] === 's-meta-same|s-meta-opp|s-meta-diff'; })(),
   'frame was still being swallowed by the meta branch');

ok('both frames ask two, on two separate sets of buttons',
   (function () { const j = metaJudgments('both', 90);
     return j.length === 2 && j[0][0] === 'position' && j[1][0] === 'position2' &&
            j[0][1] !== j[1][1]; })(),
   'quinary could not state two answers at once — the tier is vapour again');

/*
 * The invariant, from both sides. A still cube makes the second judgement a copy
 * of the first, which is quaternary charging twice; a turn between the two moves
 * is what makes the screen answer its own fact.
 */
ok('with a still cube the screen answer IS the cube answer',
   (function () { const j = metaJudgments('both', 0);
     return j.length === 2 && j[0][2] === 'meta-same' && j[1][2] === 's-meta-same'; })(),
   'the rotation-invariance this tier is built on does not hold');

ok('and a quarter turn between the moves pulls them apart',
   (function () { const j = metaJudgments('both', 90);
     /* Cube frame: east then east — the same direction, whatever the cube did.
        Screen frame: what went to the right now goes away from you, which is
        square to it. Two true answers about one event, and neither recoverable
        from the other without knowing how far the cube turned. */
     return j.length === 2 && j[0][2] === 'meta-same' && j[1][2] === 's-meta-diff'; })(),
   'the screen frame answered the cube-frame question after a 90-degree turn');

ok('a turn the eye can read leaves both frames answerable and disagreeing',
   (function () { const j = metaJudgments('both', 180);
     /* Reversed on screen while unchanged on the cube: the one case that proves
        the second frame is carrying its own information rather than a copy. */
     return j.length === 2 && j[0][2] === 'meta-same' && j[1][2] === 's-meta-opp'; })(),
   'a half turn did not reverse the move on screen');

/*
 * The quantisation. A projected move is floats, and an exact test would call
 * almost every pair of them oblique — so the screen vector is rounded to the six
 * directions the screen deck already answers in, at the same EPS the first-order
 * screen judgement uses.
 */
/*
 * And the tier is named for what the block asks, not for what is switched on. A
 * still cube with both frames ticked asks the quaternary question twice; calling
 * that quinary is the same overclaim as charging Load for it.
 */
ok('a still cube with both frames ticked is not quinary',
   (function () {
     vm.runInContext(`cfg.meta = true; cfg.frame = 'both'; cfg.rotation = false;
                      cfg.streams.position = 'relational';`, geo);
     const still = g4('relationalComplexity(cfg)');
     vm.runInContext('cfg.rotation = true;', geo);
     return still === 4 && g4('relationalComplexity(cfg)') === 5;
   })(),
   'the HUD would print quinary over a block whose second answer restates the first');

ok('and neither is a second frame of a judgement that names no direction',
   (function () {
     vm.runInContext(`cfg.meta = true; cfg.frame = 'both'; cfg.rotation = true;
                      cfg.streams.position = 'identity';`, geo);
     const r = g4('relationalComplexity(cfg)');
     vm.runInContext("cfg.streams.position = 'relational';", geo);
     return r < 5;
   })(),
   'meta and frame are dead settings while position is judged as identity');

ok('a projected move is quantised to the directions the deck can name',
   (function () {
     vm.runInContext("cfg.coordAxes = [];", geo);
     const v = g4(`screenVectorOf({ cellIdx: idx(0,1,1), matrix: spin(20) },
                                  { cellIdx: idx(1,1,1), matrix: spin(20) })`);
     return v.every(c => c === 0 || c === 1 || c === -1);
   })(),
   'the screen relation is being derived from a float nobody can see');

vm.runInContext("cfg.meta = false; cfg.frame = 'cube';", geo);

/* The count that makes the mode less slow: how many directions are orthogonal
   to a given move, once a move may combine axes. */
const orthCount = (vec, d) => {
  vm.runInContext(`cfg.coordAxes = ${d >= 4 ? "['pitch']" : '[]'};`, geo);
  return g4(`(function () {
    var out = [], v = [];
    (function walk(w) {
      if (w.length === ${d}) { if (w.some(function (c) { return c !== 0; })) v.push(w.slice()); return; }
      [-1, 0, 1].forEach(function (c) { walk(w.concat(c)); });
    })([]);
    return v.filter(function (b) { return metaRelationOf(${JSON.stringify(vec)}.slice(0, ${d}), b) === 'diff'; }).length;
  })()`);
};

ok('an axis-aligned move has more than two ways to be crossed',
   orthCount([1,0,0,0], 3) > 2,
   `counted ${orthCount([1,0,0,0], 3)} in three dimensions, where a single-axis`
   + ' move had exactly two');
ok('and a diagonal has its own set',
   orthCount([1,1,0,0], 3) >= 2,
   `counted ${orthCount([1,1,0,0], 3)} orthogonal to a two-axis move`);
ok('the fourth dimension widens it again',
   orthCount([1,0,0,0], 4) > orthCount([1,0,0,0], 3),
   `${orthCount([1,0,0,0], 4)} at four dimensions against`
   + ` ${orthCount([1,0,0,0], 3)} at three`);

/* A diagonal has no single name, and now it has several. */
vm.runInContext("cfg.coordAxes = [];", geo);
ok('a composite move can be spelled out',
   g4(`moveNames([1,-1,0]).join('+')`) === 'east+north',
   `named ${g4(`moveNames([1,-1,0]).join('+')`)}`);
ok('and a single-axis one reads as the one axis',
   g4(`moveNames([0,0,1]).join('+')`) === 'above');

/* ------------------------------------------------------------------ *
 * What the generator actually draws                                  *
 * ------------------------------------------------------------------ *
 *
 * `pickMetaMove` is lifted out of trials.js and run against the same lattice,
 * because the bounds it enforces are the ones nothing downstream re-checks: a
 * level outside its pool renders as an undefined colour or a missing tone, and
 * a move past the cap is a displacement the player was told could not happen.
 */
const trialsSrc = fs.readFileSync(path.join(ROOT, 'js/trials.js'), 'utf8');
const pmAt = trialsSrc.indexOf('function pickMetaMove');
vm.runInContext(trialsSrc.slice(pmAt, trialsSrc.indexOf('\n}\n', pmAt) + 2), geo);
/* The two helpers it reaches for, which live in files with a DOM behind them. */
vm.runInContext(`
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  var randInt = function (n) { return Math.floor(Math.random() * n); };
`, geo);

[['pitch'], ['pitch', 'color', 'size', 'quantity']].forEach(list => {
  [2, 3].forEach(cap => {
    vm.runInContext(`cfg.coordAxes = ${JSON.stringify(list)}; cfg.magnitudeCap = ${cap};`, geo);
    const bad = g4(`(function () {
      var axes = ${JSON.stringify(list)}, out = [];
      for (var t = 0; t < ${list.length > 1 ? 25 : 200}; t++) {
        var from = { cellIdx: idx(1,1,1) };
        axes.forEach(function (k) { from[k] = 1; });
        var A = [1, 0, 0].concat(axes.map(function () { return 0; }));
        var m = pickMetaMove(from.cellIdx, from, A, -1);
        if (!m) { out.push('drew nothing'); break; }
        axes.forEach(function (k) {
          var v = m.levels[k];
          if (v == null || v < 0 || v >= poolFor(k).length) out.push(k + ' level ' + v);
        });
        var c = state.cells[m.cellIdx];
        [c.x, c.y, c.z].forEach(function (q) { if (q < 0 || q > 2) out.push('off lattice'); });
      }
      return out.slice(0, 3);
    })()`);
    ok(`every drawn move is in bounds — ${list.length} extra at cap ${cap}`,
       bad.length === 0, bad.join('; '));
  });
});

/*
 * The cap and the pool are the same fact stated twice: a pool of cap+1 levels
 * makes the furthest step exactly the cap and makes every level reachable, and
 * it is the pool — not the offset list — that bounds a drawn move. So the
 * length is the thing worth guarding.
 */
Object.keys(g4('COORD_POOLS')).forEach(k => {
  [2, 3].forEach(cap => {
    vm.runInContext(`cfg.coordAxes = ['${k}']; cfg.magnitudeCap = ${cap};`, geo);
    ok(`${k} has exactly ${cap + 1} levels at cap ${cap}`,
       g4(`poolFor('${k}').length`) === cap + 1,
       `${g4(`poolFor('${k}').length`)} levels — either a step past the cap fits, `
       + 'or the furthest one does not');
  });
});

/* And the furthest step is not merely permitted but drawn, which is the point of
   raising the cap. */
[2, 3].forEach(cap => {
  vm.runInContext(`cfg.coordAxes = ['pitch']; cfg.magnitudeCap = ${cap};`, geo);
  const far = g4(`(function () {
    var most = 0;
    for (var t = 0; t < 200; t++) {
      var from = { cellIdx: idx(1,1,1), pitch: 0 };
      var m = pickMetaMove(from.cellIdx, from, [1, 0, 0, 0], -1);
      if (m) most = Math.max(most, Math.abs(m.levels.pitch - 0));
    }
    return most;
  })()`);
  ok(`a step of ${cap} does get drawn at cap ${cap}`, far === cap,
     `the furthest step drawn was ${far}`);
});

/* And the relation it draws is always one of the three that have a button. */
vm.runInContext("cfg.coordAxes = ['pitch', 'size']; cfg.magnitudeCap = 2;", geo);
const rels = g4(`(function () {
  var seen = {};
  for (var t = 0; t < 400; t++) {
    var from = { cellIdx: idx(1,1,1), pitch: 1, size: 1 };
    var A = [1, 0, 0, 0, 0];
    var m = pickMetaMove(from.cellIdx, from, A, -1);
    if (!m) continue;
    var b = { cellIdx: m.cellIdx, pitch: m.levels.pitch, size: m.levels.size };
    seen[String(metaRelationOf(A, moveVectorOf(from, b)))] = true;
  }
  return Object.keys(seen).sort();
})()`);
ok('no trial is drawn with no relation at all',
   rels.indexOf('null') < 0, `drew ${rels.join(', ')}`);
ok('and all four relations do get drawn, oblique among them',
   ['same', 'opp', 'diff', 'obl'].every(r => rels.indexOf(r) >= 0),
   `drew ${rels.join(', ')}`);

/*
 * How often each relation actually comes up, from random positions against
 * random previous moves — which is the block, rather than the one start cell
 * the checks above use.
 *
 * This is what the weights are for, and the reason to measure rather than
 * assert the weights themselves: `chanceOf` scores a block against its own
 * modal answer, so the base rates ARE the difficulty. Two ways to get this
 * wrong, and both are silent. Oblique is the biggest bucket once the space is
 * wide, so drawing uniformly over destinations rather than over types would
 * make "press nothing" the usual answer and reward sitting the block out. And
 * same and opposite are each a single direction out of the whole space, so a
 * wall blocks them equally — leaving opposite at weight 1 while same carried 3
 * starved it to under a tenth of trials.
 */
const relShare = (axes) => {
  vm.runInContext(`cfg.coordAxes = ${JSON.stringify(axes)};`, geo);
  return g4(`(function () {
    var axes = ${JSON.stringify(axes)}, dims = 3 + axes.length;
    var n = { same: 0, opp: 0, diff: 0, obl: 0 }, total = 0;
    for (var t = 0; t < 2000; t++) {
      var ci = randInt(state.cells.length);
      var from = { cellIdx: ci };
      axes.forEach(function (k) { from[k] = randInt(poolFor(k).length); });
      /* A random previous move, composite as often as the task makes them. */
      var A = [];
      for (var i = 0; i < dims; i++) A.push(randInt(3) - 1);
      if (A.every(function (c) { return c === 0; })) continue;
      var m = pickMetaMove(ci, from, A, -1);
      if (!m) continue;
      var b = { cellIdx: m.cellIdx };
      axes.forEach(function (k) { b[k] = m.levels[k]; });
      var r = metaRelationOf(A, moveVectorOf(from, b));
      if (n[r] == null) continue;
      n[r]++; total++;
    }
    Object.keys(n).forEach(function (k) { n[k] = n[k] / total; });
    return n;
  })()`);
};

[[], ['pitch'], ['pitch', 'color']].forEach(axes => {
  const n = relShare(axes);
  const where = axes.length ? axes.join(' + ') : 'the cube alone';
  const shown = Object.keys(n).map(k => `${k} ${Math.round(n[k] * 100)}%`).join(', ');
  /* Chance on this stream is the modal answer's share. Half would put it back
     where three relations and one forced answer had it. */
  ok(`no one relation owns the block with ${where}`,
     Math.max(...Object.values(n)) < 0.45, shown);
  ok(`and every relation is askable with ${where}`,
     Math.min(...Object.values(n)) > 0.08, shown);
});
vm.runInContext("cfg.coordAxes = ['pitch', 'size'];", geo);
vm.runInContext("cfg.coordAxes = ['pitch']; cfg.magnitudeCap = 2;", geo);

/* ------------------------------------------------------------------ *
 * Every axis has a button                                            *
 * ------------------------------------------------------------------ *
 *
 * A coordinate axis is judged inside the *position* judgement while the
 * property's own stream is off, so its two poles have to appear on the position
 * deck or the trial asks something with no key to answer it — which shows up as
 * a run of misses on a stream the player never turned on.
 *
 * The whole check is "what can be asked" against "what can be pressed", read
 * off the same two functions the app uses.
 */
const deckSrc = fs.readFileSync(path.join(ROOT, 'js/deck.js'), 'utf8');
vm.runInContext(deckSrc.replace(/^"use strict";/, ''), geo);

const deckIds = () => g4(`(function () {
  var g = deckGroups().filter(function (x) { return x.key === 'position'; })[0];
  return g ? g.channels.map(function (c) { return c.id; }) : [];
})()`);

[[], ['pitch'], ['color', 'size', 'quantity']].forEach(list => {
  vm.runInContext(`cfg.coordAxes = ${JSON.stringify(list)}; cfg.meta = false; cfg.frame = 'cube';`, geo);
  const ids = deckIds();
  const askable = g4('cardinalIds()').flat();
  ok(`every direction can be pressed with ${list.length ? list.join(' + ') : 'the cube alone'}`,
     askable.every(id => ids.indexOf(id) >= 0),
     `asked ${askable.filter(id => ids.indexOf(id) < 0).join(', ')} with no button`);
  ok(`and nothing extra is offered`,
     ids.length === askable.length,
     `${ids.length} buttons for ${askable.length} directions: ${ids.join(', ')}`);
});

/* At quaternary the answer is the relation between two moves, so the axes widen
   the space without touching the deck at all — the reason this scales. */
vm.runInContext("cfg.coordAxes = ['pitch', 'size']; cfg.meta = true; cfg.frame = 'cube';", geo);
ok('quaternary asks the same three questions however wide the space is',
   deckIds().length === 3, `${deckIds().length} buttons: ${deckIds().join(', ')}`);
vm.runInContext("cfg.coordAxes = ['pitch']; cfg.meta = false;", geo);

/* ------------------------------------------------------------------ *
 * Which mode owns the extra axes                                     *
 * ------------------------------------------------------------------ *
 *
 * Progression keeps its own copy, for the reason cfg.feedback exists twice: a
 * setting written by one mode and read by the other is invisible until you are
 * in the other mode wondering why the task changed. Extra axes are worse than
 * feedback that way — they change what a recorded rung is about.
 *
 * Source scans, because there is no DOM here. Each names the writer and the
 * store it must read, so a line copied from the other mode fails.
 */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const wir = fs.readFileSync(path.join(ROOT, 'js/wiring.js'), 'utf8');
const sui = fs.readFileSync(path.join(ROOT, 'js/settings-ui.js'), 'utf8');
const body = (src, fn) => {
  const at = src.indexOf('function ' + fn);
  return at < 0 ? '' : src.slice(at, src.indexOf('\n}', at));
};

const COORD_FIELDS = ['coordAxes', 'magnitudeCap', 'pitchLoudness'];
[['applyProgression', 'progCfg', 'freeCfg'],
 ['applyFree', 'freeCfg', 'progCfg']].forEach(([fn, mine, theirs]) => {
  const src = body(blk, fn);
  COORD_FIELDS.forEach(f => {
    ok(`${fn} sets ${f} from ${mine}`,
       new RegExp(`${f}:[^,\n]*${mine}`).test(src),
       `${fn} either leaves ${f} to whatever the other mode left behind, or reads ${theirs}`);
  });
});
ok('a ladder run cannot inherit Free Play\'s axes',
   !new RegExp('freeCfg').test(body(blk, 'applyProgression')));

const per = fs.readFileSync(path.join(ROOT, 'js/persistence.js'), 'utf8');
const resetBody = body(per, 'resetInMemoryState');
/* The assign that clears each store, read out of the reset rather than pattern-
   matched across it, so a field listed on the wrong store still fails. */
const clears = store => {
  const at = resetBody.indexOf('Object.assign(' + store);
  return at < 0 ? '' : resetBody.slice(at, resetBody.indexOf('});', at));
};
COORD_FIELDS.forEach(f => {
  ['progCfg', 'freeCfg'].forEach(store => {
    ok(`a reset clears ${f} on ${store}`,
       clears(store).indexOf(f) >= 0,
       `a new profile would start with the last profile's ${f}`);
  });
});

/* Both panes offer every property, and every box names a real one. */
['coordAxes', 'progCoordAxes'].forEach(id => {
  const at = html.indexOf(`id="${id}"`);
  const grp = at < 0 ? '' : html.slice(at, html.indexOf('</div>', at));
  const offered = (grp.match(/data-coord="(\w+)"/g) || [])
    .map(m => m.replace(/.*"(\w+)"/, '$1'));
  ok(`${id} offers every property that can be an axis`,
     Object.keys(g4('COORD_POOLS')).every(k => offered.indexOf(k) >= 0),
     `offers ${offered.join(', ') || 'nothing'}`);
  ok(`and offers nothing that has no pool`,
     offered.length > 0 && offered.every(k => g4(`!!COORD_POOLS['${k}']`)),
     `${offered.join(', ')} against pools for ${Object.keys(g4('COORD_POOLS')).join(', ')}`);
  ok(`${id} is wired to a handler`,
     wir.indexOf(`#${id} input[data-coord]`) >= 0,
     'the boxes render and do nothing');
});

/* Every id the sync touches has to exist, or syncSettingsUI throws and the whole
   settings screen stops updating — which is how a silent one of these hides. */
['magnitudeCap', 'coordCount', 'pitchLoudness',
 'progMagnitudeCap', 'progCoordCount', 'progPitchLoudness'].forEach(id => {
  ok(`#${id} exists for the sync to write to`,
     html.indexOf(`id="${id}"`) >= 0);
});
ok('both panes sync through the one helper',
   (sui.match(/syncCoordUI\(/g) || []).length >= 3,
   'a second copy of the sync is how the two modes drift apart');

ok('a fresh profile starts on the default tone pool',
   /toneCount:\s*TONE_DEFAULT/.test(clears('freeCfg')) &&
   /tones:\s*TONE_DEFAULT/.test(resetBody),
   'a new profile would inherit the last one\'s tone pool, in both modes');


/* ------------------------------------------------------------------ *
 * Reading the slot, and drawing less of it                           *
 * ------------------------------------------------------------------ *
 *
 * Three display options answering one complaint: the lattice is mostly surfaces
 * nobody reads, and the slot's position has to be deduced from a projection
 * rather than read. Source scans, because there is no DOM here — each names the
 * control, the class or the handler that has to exist for the option to do
 * anything at all.
 */
const geoSrc = fs.readFileSync(path.join(ROOT, 'js/geometry.js'), 'utf8');
const scene = fs.readFileSync(path.join(ROOT, 'css/scene.css'), 'utf8');
const tri = fs.readFileSync(path.join(ROOT, 'js/trials.js'), 'utf8');

/* geometry.js is half DOM, so only the tables are lifted out of it — the real
   ones, read from the file the browser loads, rather than a copy kept here. */
const vis = vm.createContext({ console, Math, Object, JSON });
['const CELL_VIS_MODES', 'const CELL_VIS_HINT', 'const READOUT_HINT'].forEach(decl => {
  const at = geoSrc.indexOf(decl);
  if (at < 0) return;
  const ends = ['];\n', '};\n'].map(e => geoSrc.indexOf(e, at)).filter(i => i > 0);
  vm.runInContext(geoSrc.slice(at, Math.min(...ends) + 2), vis);
});
const g5 = k => vm.runInContext(k, vis);

/* The rails without the lattice they used to be drawn over. */
ok('the rails can be had without the lattice',
   /value="rails"/.test(html) && /rails:/.test(geoSrc) &&
   /'rails'/.test(geoSrc),
   'the option is offered, hinted or applied, but not all three');
ok('and that mode hides the cells while keeping the rails and the frame',
   /\.vis-rails \.cell\b/.test(scene) &&
   /\.vis-rails \.guides/.test(scene) &&
   /\.vis-rails \.cube-frame/.test(scene),
   'a rails block would come out as either a full lattice or a bare cell');
ok('every visibility mode the select offers is one the cube applies',
   (function () {
     const at = html.indexOf('id="cellVis"');
     const sel = html.slice(at, html.indexOf('</select>', at));
     const offered = (sel.match(/value="(\w+)"/g) || []).map(m => m.replace(/.*"(\w+)"/, '$1'));
     const applied = g5('CELL_VIS_MODES');
     return offered.length === applied.length &&
            offered.every(v => applied.indexOf(v) >= 0);
   })(),
   'a slot-visibility option that names a class nothing toggles');
ok('and every one of them has a hint',
   g5('CELL_VIS_MODES').every(v => g5(`!!CELL_VIS_HINT['${v}']`)),
   'a mode with no hint is a mode nobody can tell from its neighbour');

/* Outline cells: an axis of its own, so it composes with every visibility mode
   rather than being a fifth one. */
ok('fill is its own axis rather than another visibility mode',
   /fill-outline/.test(geoSrc) && /cellFill/.test(geoSrc) &&
   g5('CELL_VIS_MODES').indexOf('outline') < 0,
   'outline was folded into slot visibility, so it cannot compose with it');
ok('and the outline takes the colour the fill would have had',
   /\.fill-outline \.cell\.active \.cell-face[^}]*--cell-active-solid/.test(scene),
   'with the face gone the colour stream loses its stimulus');
ok('an outline cell draws no fill at all',
   /\.fill-outline \.cell-face\s*\{[^}]*background:\s*none\s*!important/.test(scene),
   'the lattice keeps its faint fills, which is most of the ink on screen');

/* The readout: the slot's coordinates, printed on the slot. */
['off', 'letters', 'numbers', 'pips'].forEach(m => {
  ok(`the readout offers ${m}`,
     html.indexOf(`value="${m}"`) >= 0 && !!g5(`READOUT_HINT['${m}']`),
     'an option with no hint behind it');
});
ok('the readout is wired to a handler',
   /\$\('slotReadout'\)\.onchange/.test(wir),
   'the control renders and does nothing');
ok('and repaints the slot already on screen without replaying it',
   /refreshReadout/.test(wir) && /function refreshReadout/.test(tri) &&
   !/renderTrial\(/.test(body(tri, 'refreshReadout')),
   'changing it mid-block either does nothing until the next trial, or replays this one\'s sound');
ok('the readout names all three axes',
   /READOUT_AXES/.test(tri) && (tri.match(/neg: '[WNB]'/g) || []).length === 3,
   'a coordinate with an axis missing is not a coordinate');

/* Both are assists on the same judgement as the move trace, so a score earned
   with them is not the same score — and the record has to say so. */
['cellFill', 'slotReadout', 'toneCount'].forEach(f => {
  ok(`${f} is stamped into the block record`,
     new RegExp(`${f}:`).test(body(blk, 'blockRecord')),
     'a block that cannot be told from one played without it');
});


/* ------------------------------------------------------------------ *
 * The quaternary ladder's two new digits                             *
 * ------------------------------------------------------------------ *
 *
 * Axis count and the magnitude cap sit above stream count on the odometer, and
 * only turn at quaternary and up — at ternary an axis is one more independent
 * up/down/neither and nothing a ladder can grade. `ladder.js` is loaded in its
 * own sandbox with the globals it reaches for, so the walk is the real one.
 */
const lad = vm.createContext({ console, Math, Array, Object, JSON });
vm.runInContext(`
  var TUNE_DEFAULTS = { targetAccuracy: 0.40 };
  var tune = { startInterval: 5000, targetInterval: 3000, maxInterval: 6500,
               nMax: 3, nAfterStimulus: 2, spinStart: 100, spinEnd: 20, spinStep: 10,
               targetAccuracy: 0.40, adapt: 'bayes' };
  var rcTier = 3;
  /* PROG_STREAMS and PROG_AXES are ladder.js's own — declaring them here would
     collide with it, and stubbing them would test a ladder nobody climbs. */
  var state = {}, cfg = {};
`, lad);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/ladder.js'), 'utf8')
  .replace(/^"use strict";/, ''), lad);
const gl = k => vm.runInContext(k, lad);

/* Walk the whole ladder from the bottom and report what it passed through. */
const walk = tier => gl(`(function () {
  rcTier = ${tier};
  var p = { streamCount:1, n:1, spinLevel:minSpinLevel(), axisCount:0, capLevel:0,
            interval:tune.startInterval };
  var rungs = 0, sawStill = false, maxAxis = 0, sawCap = false, kinds = {};
  for (var i = 0; i < 20000; i++) {
    if (p.spinLevel === 0) sawStill = true;
    maxAxis = Math.max(maxAxis, p.axisCount || 0);
    if (p.capLevel) sawCap = true;
    kinds[carryKind(p)] = true;
    rungs++;
    if (!advanceLadder(p)) break;
  }
  return { rungs: rungs, sawStill: sawStill, maxAxis: maxAxis, sawCap: sawCap,
           kinds: Object.keys(kinds).sort().join(','), end: p };
})()`);

const t3 = walk(3), t4 = walk(4), t5 = walk(5);

ok('the ternary ladder is exactly the ladder it was',
   t3.maxAxis === 0 && t3.sawCap === false,
   'ternary picked up digits that only mean something at quaternary');
ok('and quaternary climbs past the last stimulus into the axes',
   t4.maxAxis === 4 && t4.sawCap === true && t4.rungs > t3.rungs,
   `quaternary ended at ${t4.maxAxis} axes, cap ${t4.sawCap}`);
ok('every new digit gets a carry of its own',
   t4.kinds.indexOf('axis') >= 0 && t4.kinds.indexOf('cap') >= 0,
   `the staircase would size an axis carry as something else: ${t4.kinds}`);
ok('the axes come in one at a time',
   gl(`(function () {
     rcTier = 4;
     var p = { streamCount: PROG_STREAMS.length, n: tune.nMax,
               spinLevel: spinLevels().length - 1, axisCount: 0, capLevel: 0 };
     var seen = [];
     for (var i = 0; i < 400 && advanceLadder(p); i++) seen.push(p.axisCount);
     return seen.slice(0, 1).join() === '1';
   })()`),
   'the first carry past the last stimulus was not a single axis');

/* Quinary never offers a still cube: with one, the screen relation is the cube
   relation and the tier's second judgement is the first one copied out. */
ok('quinary never puts a still cube on the ladder',
   t5.sawStill === false && t3.sawStill === true,
   'a quinary rung would have asked the same relation twice and scored it twice');
ok('and stepping backwards cannot reach one either',
   gl(`(function () {
     rcTier = 5;
     var p = { streamCount:1, n:1, spinLevel:1, axisCount:0, capLevel:0 };
     for (var i = 0; i < 200; i++) { regressLadder(p); if (p.spinLevel === 0) return false; }
     return true;
   })()`),
   'regressing off the bottom of the quinary ladder stopped the cube');

/*
 * Down is not the exact inverse of up, and never was: a rung is entered at
 * `nAfterStimulus` and stepped off at N=1, so regress deliberately visits rungs
 * the climb skipped — that is the easing-off it exists for. What it does owe is
 * that every state it passes through is a state the rest of the app can render:
 * an axis count inside the list, a spin inside the levels and above the tier's
 * floor, and no digit walking off the bottom.
 */
ok('stepping all the way back down stays inside the ladder at every rung',
   gl(`(function () {
     rcTier = 4;
     var levels = spinLevels().length - 1;
     var p = { streamCount:1, n:1, spinLevel:0, axisCount:0, capLevel:0 };
     for (var i = 0; i < 20000; i++) if (!advanceLadder(p)) break;   // to the top
     for (var j = 0; j < 20000; j++) {
       if (!(p.axisCount >= 0 && p.axisCount <= PROG_AXES.length)) return 'axisCount ' + p.axisCount;
       if (!(p.capLevel === 0 || p.capLevel === 1)) return 'capLevel ' + p.capLevel;
       if (!(p.n >= 1)) return 'n ' + p.n;
       if (!(p.streamCount >= 1)) return 'streamCount ' + p.streamCount;
       if (!(p.spinLevel >= minSpinLevel() && p.spinLevel <= levels)) return 'spin ' + p.spinLevel;
       if (p.streamCount === 1 && p.n === 1 && !p.axisCount && !p.capLevel) return true;
       regressLadder(p);
     }
     return 'never reached the bottom';
   })()`) === true,
   'regressing off the top of the quaternary ladder leaves it somewhere it cannot render');

/* And it unwinds in the order it wound: the cap before the axes it stretched,
   the axes before the streams they were converted from. A digit undone out of
   order drops the player onto a rung harder than the one they just failed. */
ok('and unwinds the digits in the order it wound them',
   gl(`(function () {
     rcTier = 4;
     var p = { streamCount:1, n:1, spinLevel:0, axisCount:0, capLevel:0 };
     for (var i = 0; i < 20000; i++) if (!advanceLadder(p)) break;
     var cappedUntil = -1, axesFellAt = -1, streamsFellAt = -1;
     for (var j = 0; j < 20000; j++) {
       if (p.capLevel) cappedUntil = j;
       if (axesFellAt < 0 && p.axisCount < PROG_AXES.length) axesFellAt = j;
       if (streamsFellAt < 0 && p.streamCount < PROG_STREAMS.length) streamsFellAt = j;
       if (streamsFellAt >= 0) break;
       regressLadder(p);
     }
     return cappedUntil < axesFellAt && axesFellAt < streamsFellAt;
   })()`),
   'the ladder gave back a stimulus before it gave back the axis that replaced it');

/* ------------------------------------------------------------------ *
 * Load can see the top half of the app                               *
 * ------------------------------------------------------------------ *
 *
 * It could not. `computeLoad` counted N, streams, lattice, interval, rotation and
 * frame, and stopped — so a ternary block and a quaternary one scored the SAME
 * number at the same settings, and four coordinate axes moved it by nothing at
 * all. Free Play's whole promise is that Load scores the setup; the part of the
 * setup worth climbing was invisible to it.
 */
const ld = vm.createContext({ console, Math, Array, Object, JSON });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/constants.js'), 'utf8')
  .replace(/^"use strict";/, ''), ld);
vm.runInContext(`
  var cfg = {};
  var STREAM_KEYS_ALL = STREAM_KEYS;
  var base = function (over) {
    var c = { n: 2, varN: 0, dim: 3, interval: 2500, rotation: false, spin: 60,
              frame: 'cube', meta: false, coordAxes: [], magnitudeCap: 2,
              streams: { position: 'relational' } };
    for (var k in (over || {})) c[k] = over[k];
    return c;
  };
`, ld);
{
  const src = fs.readFileSync(path.join(ROOT, 'js/block.js'), 'utf8');
  const at = src.indexOf('function computeLoad');
  vm.runInContext(src.slice(at, src.indexOf('\n}', at) + 2), ld);
}
/* computeLoad reads the live cfg, so each call swaps it in. */
const load = over => {
  vm.runInContext(`cfg = base(${JSON.stringify(over || {})});`, ld);
  return vm.runInContext('computeLoad()', ld);
};

const ternary = load({});
ok('quaternary outscores ternary at identical settings',
   load({ meta: true }) > ternary,
   'meta was worth nothing to Load, so the ladder\'s headline number could not see the tier');
ok('and quinary outscores quaternary',
   load({ meta: true, frame: 'both', rotation: true }) > load({ meta: true }),
   'the second frame was free');
ok('but only while the cube actually turns',
   load({ meta: true, frame: 'both', rotation: false }) <
   load({ meta: true, frame: 'both', rotation: true }),
   'a still cube was charged for a second binding it does not ask');
ok('each coordinate axis is worth something',
   load({ coordAxes: ['pitch'] }) > ternary &&
   load({ coordAxes: ['pitch', 'color'] }) > load({ coordAxes: ['pitch'] }),
   'the most principled difficulty in the app moved Load by nothing');
ok('and is worth more again under a second-order judgement',
   load({ meta: true, coordAxes: ['pitch'] }) - load({ meta: true }) >
   load({ coordAxes: ['pitch'] }) - ternary,
   'an axis counted the same whether or not anything asked about orthogonality');
ok('a longer step on the axes costs more than a shorter one',
   load({ coordAxes: ['pitch'], magnitudeCap: 3 }) > load({ coordAxes: ['pitch'] }));
/* More notes is harder on both questions the tone stream can ask — "the same
   note" has more neighbours to be confused with, and "higher or lower" is a
   smaller interval to hear — so Load has to know about it, or Free Play could
   hand itself a twelve-note pool for free. */
ok('a finer tone pool is worth more Load',
   load({ streams: { position: 'relational', pitch: 'identity' }, toneCount: 12 }) >
   load({ streams: { position: 'relational', pitch: 'identity' }, toneCount: 4 }),
   'the tone count moved the task without moving the score of the setup');
ok('and only while the tones are a stream',
   load({ streams: { position: 'relational' }, toneCount: 12 }) ===
   load({ streams: { position: 'relational' }, toneCount: 4 }),
   'Load charged for a pool nothing draws from');
ok('a reference frame is worth nothing while position is not relational',
   load({ streams: { position: 'identity' }, frame: 'both' }) ===
   load({ streams: { position: 'identity' }, frame: 'cube' }),
   'Load charged 34 for a second frame of a judgement that names no direction');
/* The rung the ladder actually climbs: a stream converted into an axis. The point
   of the trade is that it buys more than it spends. */
ok('converting a stream into an axis is a step up, not sideways',
   load({ meta: true, streams: { position: 'relational', pitch: 'identity' } }) <
   load({ meta: true, streams: { position: 'relational' }, coordAxes: ['pitch'] }),
   'the axis digit would lower Load, so the ladder would climb into an easier block');

console.log(bad ? `\n${bad} FAILED` : '\nall checks passed');

process.exit(bad ? 1 : 0);